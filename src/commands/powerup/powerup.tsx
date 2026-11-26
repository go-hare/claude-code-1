import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from '@anthropic/ink';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { POWERUP_LESSONS, type PowerupLesson, loadUnlockedPowerups, saveUnlockedPowerups } from './lessons.js';

const FRAME_INTERVAL_MS = 3000;

function LessonDemo({ frames }: { frames: readonly string[] }): React.ReactNode {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (frames.length <= 1) return;
    const timer = setInterval(() => {
      setFrameIndex(prev => (prev + 1) % frames.length);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [frames]);

  const current = frames[frameIndex % frames.length] ?? '';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} marginY={1}>
      <Text>{current}</Text>
      {frames.length > 1 && (
        <Box marginTop={1}>
          <Text dimColor>
            demo {frameIndex + 1}/{frames.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function PowerupDialog({ onExit }: { onExit: (msg?: string) => void }): React.ReactNode {
  const [unlocked, setUnlocked] = useState<Set<string>>(() => loadUnlockedPowerups());
  const [activeLesson, setActiveLesson] = useState<PowerupLesson | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const openLesson = useCallback(
    (lesson: PowerupLesson) => {
      setActiveLesson(lesson);
      logEvent('tengu_powerup_lesson_opened', {
        lesson_id: lesson.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        was_already_unlocked: unlocked.has(lesson.id),
        unlocked_count: unlocked.size,
      });
    },
    [unlocked],
  );

  const markDone = useCallback(
    (lessonId: string) => {
      if (unlocked.has(lessonId)) return;
      const next = new Set(unlocked).add(lessonId);
      setUnlocked(next);
      saveUnlockedPowerups(next);
      logEvent('tengu_powerup_lesson_completed', {
        lesson_id: lessonId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        unlocked_count: next.size,
        all_unlocked: next.size === POWERUP_LESSONS.length,
      });
    },
    [unlocked],
  );

  useInput((_input, key) => {
    if (activeLesson) {
      if (key.escape) {
        setActiveLesson(null);
      } else if (key.return) {
        markDone(activeLesson.id);
        setActiveLesson(null);
      }
      return;
    }

    if (key.escape) {
      onExit('Power-ups closed');
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(prev => (prev - 1 + POWERUP_LESSONS.length) % POWERUP_LESSONS.length);
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(prev => (prev + 1) % POWERUP_LESSONS.length);
      return;
    }
    if (key.return) {
      const chosen = POWERUP_LESSONS[selectedIndex];
      if (chosen) openLesson(chosen);
    }
  });

  if (activeLesson) {
    const isDone = unlocked.has(activeLesson.id);
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={1}>
        <Box justifyContent="space-between">
          <Text bold>{activeLesson.title}</Text>
          {isDone && <Text color="success">done</Text>}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{activeLesson.summary}</Text>
          <LessonDemo frames={activeLesson.frames} />
          <Text>{activeLesson.details}</Text>
          <Box marginTop={1}>
            <Text dimColor>{activeLesson.tip}</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter mark done · Esc go back</Text>
        </Box>
      </Box>
    );
  }

  const allDone = unlocked.size === POWERUP_LESSONS.length;

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={1}>
      <Box justifyContent="space-between">
        <Text bold>Power-ups</Text>
        <Text dimColor>
          {unlocked.size}/{POWERUP_LESSONS.length} done
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {allDone
            ? 'All powered up. Now go build something.'
            : 'Each power-up teaches one thing Claude Code can do that most people miss. Open one, read it, try it, mark it done.'}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {POWERUP_LESSONS.map((lesson, idx) => {
          const isSelected = idx === selectedIndex;
          const isDone = unlocked.has(lesson.id);
          return (
            <Text key={lesson.id} color={isSelected ? 'suggestion' : undefined}>
              {isSelected ? '❯ ' : '  '}
              {isDone ? '✓ ' : '○ '}
              {lesson.title} <Text dimColor>· {lesson.tagline}</Text>
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ select · Enter open · Esc close</Text>
      </Box>
    </Box>
  );
}

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <PowerupDialog onExit={msg => onDone(msg, { display: 'system' })} />;
}
