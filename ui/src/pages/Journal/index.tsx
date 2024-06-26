import React, { useEffect, useState } from 'react';

import { Text, Pane, PlusIcon, RepeatIcon, FilterRemoveIcon } from 'evergreen-ui';

import Background from '../../components/Background';
import { Tag, Thought } from '../../types';
import { useAPI } from '../../hooks';
import ThoughtEditor from '../../components/ThoughtEditor';
import DateRangePicker from './DateRangePicker';
import TagBar from '../../components/TagBar';
import theme from '../../theme';
import { useResponsive } from '../../hooks/useResponsive';

function Journal() {
  const api = useAPI();
  const { isMobile } = useResponsive();
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [startDate, setStartDate] = React.useState<Date>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = React.useState<Date>(new Date());
  const [filterTags, setFilterTags] = useState<string[]>([]);

  const handleStartDateChange = (selectedDate: Date | null) => {
    if (selectedDate) {
      setStartDate(selectedDate);
    }
  };

  const handleEndDateChange = (selectedDate: Date | null) => {
    if (selectedDate) {
      setEndDate(selectedDate);
    }
  };

  const cycle = () => {
    if (tags.length === 0) {
      return;
    }

    if (filterTags.length === 0) {
      setFilterTags([tags[0].id]);
    } else {
      const currentTagIndex = tags.findIndex((tag) => tag.id === filterTags[0]);
      const nextTagIndex = (currentTagIndex + 1) % tags.length;
      setFilterTags([tags[nextTagIndex].id]);
    }
  };

  const clearFilter = () => {
    setFilterTags([]);
  };

  useEffect(() => {
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];

    const bodyOptions: {
      startDate?: string;
      endDate?: string;
      tags?: string[];
    } = {
      startDate: formattedStartDate,
      endDate: formattedEndDate
    };

    if (filterTags.length > 0) {
      bodyOptions.tags = filterTags;
    }

    api.listThoughts(bodyOptions).then((thoughts) => {
      if (thoughts) {
        setThoughts(thoughts);
      }
    });
    api.listTags().then((tags) => {
      if (tags) {
        setTags(tags);
      }
    });
  }, [startDate, endDate, filterTags]);

  const onUpdateThought = (thought: Thought) => {
    api.updateThought({ thought }).then((updatedThought) => {
      if (updatedThought) {
        setThoughts((prev) => {
          const index = prev.findIndex((t) => t.id === updatedThought.id);
          if (index === -1) return prev;
          const newThoughts = [...prev];
          newThoughts[index] = updatedThought;
          return newThoughts;
        });
      }
    });
  };

  const onDeleteThought = (thought: Thought) => {
    api.deleteThought({ id: thought.id }).then(() => {
      setThoughts((prev) => {
        const index = prev.findIndex((t) => t.id === thought.id);
        if (index === -1) return prev;
        const newThoughts = [...prev];
        newThoughts.splice(index, 1);
        return newThoughts;
      });
    });
  };

  const onCreateThought = (thought: Omit<Thought, 'id'>) => {
    api.createThought({ thought }).then((createdThought) => {
      if (createdThought) {
        setThoughts((prev) => [createdThought, ...prev]);
      }
    });
  };

  const onUpdateTags = (tags: Tag[]) => {
    setTags(tags);
  };

  return (
    <Background>
      <Pane display="flex" flexDirection="column" maxHeight="calc(100vh - 48px)" padding={16}>
        <Pane
          paddingBottom={16}
          display="flex"
          flexDirection={isMobile ? 'column' : 'row'}
          justifyContent="space-between"
        >
          {/* TODO: Replace this with actual button. */}
          <Pane
            padding={12}
            backgroundColor={theme.colors.primary}
            marginBottom={isMobile ? 16 : 0}
            width={isMobile ? 'fit-content' : 'auto'}
            borderRadius={4}
            cursor="pointer"
            display="flex"
            flexDirection="row"
            alignItems="center"
            onClick={() => {
              onCreateThought({
                content: '',
                tags: [],
                created_at: new Date().toISOString()
              });
            }}
          >
            <PlusIcon size={16} marginRight={16} color="white" />
            <Text fontSize="1rem" color="white" fontWeight={500} paddingRight={isMobile ? 16 : 0}>
              New Thought
            </Text>
          </Pane>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            handleStartDateChange={handleStartDateChange}
            handleEndDateChange={handleEndDateChange}
          />
        </Pane>

        <Pane
          display="flex"
          flexDirection={isMobile ? 'column' : 'row'}
          justifyContent="flex-end"
          alignItems={isMobile ? 'flex-start' : 'center'}
        >
          <TagBar tags={filterTags} allTags={tags} onSave={setFilterTags} updateTags={setTags} padding={4} />
          <Pane
            display="flex"
            flexDirection="row"
            alignItems="center"
            marginTop={isMobile ? 8 : 0}
            marginLeft={isMobile ? 0 : 8}
          >
            <Pane
              padding={12}
              backgroundColor="rgba(255, 255, 255, 0.7)"
              width={isMobile ? 'fit-content' : 'auto'}
              borderRadius={4}
              cursor="pointer"
              display="flex"
              flexDirection="row"
              alignItems="c>enter"
              onClick={clearFilter}
            >
              <FilterRemoveIcon size={16} marginRight={16} color={theme.colors.primary} />
              <Text fontSize="1rem" fontWeight={500} paddingRight={isMobile ? 16 : 0}>
                Clear Tags
              </Text>
            </Pane>
            <Pane
              padding={12}
              marginLeft={8}
              backgroundColor="rgba(255, 255, 255, 0.7)"
              width={isMobile ? 'fit-content' : 'auto'}
              borderRadius={4}
              cursor="pointer"
              display="flex"
              flexDirection="row"
              alignItems="center"
              onClick={cycle}
            >
              <RepeatIcon size={16} marginRight={16} color={theme.colors.primary} />
              <Text fontSize="1rem" fontWeight={500} paddingRight={isMobile ? 16 : 0}>
                Cycle
              </Text>
            </Pane>
          </Pane>
        </Pane>

        <Pane flex="1" className="browseBodyNoScrollbar" paddingTop={16}>
          {thoughts.map((thought) => (
            <ThoughtEditor
              key={thought.id}
              thought={thought}
              onUpdate={onUpdateThought}
              onClickDelete={() => onDeleteThought(thought)}
              onUpdateTags={onUpdateTags}
              allTags={tags}
              isDisabled={false}
            />
          ))}
        </Pane>
      </Pane>
    </Background>
  );
}

export default Journal;
