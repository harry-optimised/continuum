from datetime import timedelta
from logging import getLogger

from api.serializers import EntrySerializer, TagSerializer, ThoughtSerializer
from django.conf import settings
from django.contrib.postgres.search import SearchVector
from django.core.mail import send_mail
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.utils.timezone import now
from django.utils.dateparse import parse_date
from django.core.exceptions import ValidationError
from django_filters.rest_framework import DjangoFilterBackend
from guardian.shortcuts import assign_perm, get_objects_for_user
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from thought.models import Entry, Tag, Thought
from thought.tasks import extract_mood, extract_actions

logger = getLogger(__name__)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def generate_report(request):
    seven_days_ago = now() - timedelta(days=7)
    entries = (
        get_objects_for_user(request.user, "view_entry", klass=Entry)
        .filter(date__gte=seven_days_ago)
        .prefetch_related(
            Prefetch("thought_set", queryset=Thought.objects.select_related("entry").prefetch_related("tags"))
        )
    )
    # Organize thoughts by tag
    thoughts_by_tag = {}
    for entry in entries:
        for thought in entry.thought_set.all():
            for tag in thought.tags.all():
                if tag.name not in thoughts_by_tag:
                    thoughts_by_tag[tag.name] = []
                thoughts_by_tag[tag.name].append(thought.content)

    # Generate report as string.
    raw_report = ""
    for tag, thoughts in thoughts_by_tag.items():
        raw_report += f"Tag: {tag}\n"
        for thought in thoughts:
            raw_report += f"  - {thought}\n"
        raw_report += "\n"

    if raw_report == "":
        return Response({"message": "No thoughts found in the last 7 days."})

    response = settings.OPENAI_CLIENT.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {
                "role": "system",
                "content": "You are a pscyhologist analysing the user's diary entries. The user will give you a dump of text containing diary entries organised by tag. You should analyse the text and write a short report with one paragraph for each tag. THe intent is to draw the users attention towards common patterns in their thinking.",
            },
            {"role": "user", "content": raw_report},
        ],
    )
    report = response.choices[0].message.content

    if not report:
        return Response({"message": "Report generation failed."})

    send_mail(
        "Your Weekly Thoughts Report",
        report,
        from_email="report@quanda.ai",
        recipient_list=[request.user.email],
        fail_silently=False,
    )

    return Response({"message": "Report generated successfully!"})


class CustomPageNumberPagination(PageNumberPagination):
    page_size = 100


class TagViewSet(viewsets.ModelViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = CustomPageNumberPagination

    def paginate_queryset(self, queryset):
        if self.action == "list":
            return super().paginate_queryset(queryset)
        return None

    def get_queryset(self):
        return get_objects_for_user(self.request.user, "view_tag", klass=Tag)

    def perform_create(self, serializer):
        tag = serializer.save()
        assign_perm("view_tag", self.request.user, tag)


class EntryViewSet(viewsets.ModelViewSet):
    queryset = Entry.objects.all()
    serializer_class = EntrySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = CustomPageNumberPagination

    def get_queryset(self):
        queryset = get_objects_for_user(self.request.user, "view_entry", klass=Entry)
        queryset = queryset.order_by("-date")
        search_query = self.request.query_params.get("search", None)
        if search_query:
            queryset = queryset.annotate(
                search=SearchVector("thought__content"),
            ).filter(search=search_query)

        # Filter by start and end date
        start_date = self.request.query_params.get("start_date", None)
        end_date = self.request.query_params.get("end_date", None)

        if start_date:
            try:
                start_date = parse_date(start_date)
                if start_date:
                    queryset = queryset.filter(date__gte=start_date)
                else:
                    raise ValidationError("Invalid start date format.")
            except ValidationError:
                pass

        if end_date:
            try:
                end_date = parse_date(end_date)
                if end_date:
                    queryset = queryset.filter(date__lte=end_date)
                else:
                    raise ValidationError("Invalid end date format.")
            except ValidationError:
                pass

        return queryset

    def paginate_queryset(self, queryset):
        if self.action == "list":
            return super().paginate_queryset(queryset)
        return None

    def perform_create(self, serializer):
        entry = serializer.save()
        assign_perm("view_entry", self.request.user, entry)

    @action(detail=True, methods=["post"], url_path="add-thought")
    def add_thought(self, request, pk=None):
        entry = self.get_object()

        if not request.user.has_perm("view_entry", entry):
            return Response(status=status.HTTP_403_FORBIDDEN)

        thought_data = request.data
        thought_data["entry"] = entry.id
        serializer = ThoughtSerializer(data=thought_data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        else:
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["put"], url_path="edit-thought/(?P<thought_id>[^/.]+)")
    def edit_thought(self, request, pk=None, thought_id=None):
        entry = self.get_object()

        if not request.user.has_perm("view_entry", entry):
            return Response(status=status.HTTP_403_FORBIDDEN)

        thought = get_object_or_404(Thought, id=thought_id, entry=entry)
        request.data["entry"] = entry.id
        serializer = ThoughtSerializer(thought, data=request.data)
        if serializer.is_valid():
            serializer.save()

            content_words = serializer.validated_data.get("content", "").split()
            if len(content_words) >= 10:
                extract_mood.delay(thought.id)
                extract_actions.delay(thought.id)

            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["delete"], url_path="delete-thought/(?P<thought_id>[^/.]+)")
    def delete_thought(self, request, pk=None, thought_id=None):
        entry = self.get_object()

        if not request.user.has_perm("view_entry", entry):
            return Response(status=status.HTTP_403_FORBIDDEN)

        thought = get_object_or_404(Thought, id=thought_id, entry=entry)
        thought.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
