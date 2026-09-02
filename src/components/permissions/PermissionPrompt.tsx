import React, { type ReactNode, type Ref, useCallback, useEffect, useMemo, useState } from 'react';
import { Box, type DOMElement, Text } from '@anthropic/ink';
import type { KeybindingAction } from '../../keybindings/types.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useSetAppState } from '../../state/AppState.js';
import type { PastedContent } from '../../utils/config.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import { type OptionWithDescription, Select } from '../CustomSelect/select.js';
import { resolveConfirmCycleModeAction } from './FilePermissionDialog/confirmCycleMode.js';

export type FeedbackType = 'accept' | 'reject';

/** DualInk analog: Select `type:'input'` for YAe/Qgy prefix (not Tab Mut). */
export type PermissionPromptInputConfig = {
  placeholder?: string;
  initialValue?: string;
  onChange: (value: string) => void;
  allowEmptySubmitToCancel?: boolean;
  showLabelWithValue?: boolean;
  labelValueSeparator?: string;
  resetCursorOnUpdate?: boolean;
};

export type PermissionPromptOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** densable Select description — Iiu/Cmy DPo kOo. */
  description?: string;
  feedbackConfig?: {
    type: FeedbackType;
    placeholder?: string;
  };
  inputConfig?: PermissionPromptInputConfig;
  keybinding?: KeybindingAction;
};

export type ToolAnalyticsContext = {
  toolName: string;
  isMcp: boolean;
};

export type PermissionPromptProps<T extends string> = {
  options: PermissionPromptOption<T>[];
  onSelect: (value: T, feedback?: string) => void;
  onCancel?: () => void;
  question?: string | ReactNode;
  toolAnalyticsContext?: ToolAnalyticsContext;
  /** densable sVc `SYg` — measure the Select container for DAA maxLabelWidth. */
  selectRef?: Ref<DOMElement>;
  /** DualInk analog Vru — Select image paste on input options. */
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void;
  pastedContents?: Record<number, PastedContent>;
  onRemoveImage?: (id: number) => void;
  /**
   * DualInk analog gold Mhy / File confirm:cycleMode idle arm.
   * Open accept/reject input collapses; otherwise this runs (accept-session).
   * Omit on non-File PermissionPrompt callers.
   */
  cycleModeAction?: () => void;
  /**
   * densable Mut chrome: Host Cmy/tyy/Mhy draw escape+amend+IOo.
   * Hide the built-in Esc/Tab footer.
   */
  hostChrome?: boolean;
  /** densable Mut hintNode — tab amend when focused on yes/no. */
  onAmendHintChange?: (visible: boolean) => void;
  /** densable Cmy classifier approved — lock Select + Esc. */
  isDisabled?: boolean;
};

const DEFAULT_PLACEHOLDERS: Record<FeedbackType, string> = {
  accept: 'tell Claude what to do next',
  reject: 'tell Claude what to do differently',
};

/**
 * Shared component for permission prompts with optional feedback input.
 *
 * Handles:
 * - "Do you want to proceed?" question with optional Tab hint
 * - Feature flag check for feedback capability
 * - Input mode toggling (Tab to expand feedback input)
 * - Analytics events for feedback interactions
 * - Transforming options to Select-compatible format
 */
export function PermissionPrompt<T extends string>({
  options,
  onSelect,
  onCancel,
  question = 'Do you want to proceed?',
  toolAnalyticsContext,
  selectRef,
  onImagePaste,
  pastedContents,
  onRemoveImage,
  cycleModeAction,
  hostChrome,
  onAmendHintChange,
  isDisabled = false,
}: PermissionPromptProps<T>): React.ReactNode {
  const setAppState = useSetAppState();
  const [acceptFeedback, setAcceptFeedback] = useState('');
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [acceptInputMode, setAcceptInputMode] = useState(false);
  const [rejectInputMode, setRejectInputMode] = useState(false);
  const [focusedValue, setFocusedValue] = useState<T | null>(null);
  // Track whether user ever entered feedback mode (persists after collapse)
  const [acceptFeedbackModeEntered, setAcceptFeedbackModeEntered] = useState(false);
  const [rejectFeedbackModeEntered, setRejectFeedbackModeEntered] = useState(false);

  // Find which option is focused and whether it has feedback config
  const focusedOption = options.find(opt => opt.value === focusedValue);
  const focusedFeedbackType = focusedOption?.feedbackConfig?.type;

  // Show Tab hint when focused on a feedback-enabled option that's not already in input mode
  const showTabHint =
    (focusedFeedbackType === 'accept' && !acceptInputMode) || (focusedFeedbackType === 'reject' && !rejectInputMode);

  useEffect(() => {
    onAmendHintChange?.(showTabHint);
  }, [showTabHint, onAmendHintChange]);

  // Transform options to Select-compatible format
  const selectOptions = useMemo((): OptionWithDescription<T>[] => {
    return options.map(opt => {
      const { value, label, description, feedbackConfig, inputConfig } = opt;

      if (inputConfig) {
        return {
          type: 'input' as const,
          label,
          value,
          placeholder: inputConfig.placeholder,
          initialValue: inputConfig.initialValue,
          onChange: inputConfig.onChange,
          allowEmptySubmitToCancel: inputConfig.allowEmptySubmitToCancel,
          showLabelWithValue: inputConfig.showLabelWithValue,
          labelValueSeparator: inputConfig.labelValueSeparator,
          resetCursorOnUpdate: inputConfig.resetCursorOnUpdate,
        };
      }

      // No feedback config = simple option
      if (!feedbackConfig) {
        return {
          label,
          value,
          ...(description !== undefined ? { description } : {}),
        };
      }

      const { type, placeholder } = feedbackConfig;
      const isInputMode = type === 'accept' ? acceptInputMode : rejectInputMode;
      const onChange = type === 'accept' ? setAcceptFeedback : setRejectFeedback;
      const defaultPlaceholder = DEFAULT_PLACEHOLDERS[type];

      // When in input mode, show input field
      if (isInputMode) {
        return {
          type: 'input' as const,
          label,
          value,
          placeholder: placeholder ?? defaultPlaceholder,
          onChange,
          allowEmptySubmitToCancel: true,
        };
      }

      // Not in input mode - show simple option
      return {
        label,
        value,
      };
    });
  }, [options, acceptInputMode, rejectInputMode]);

  // Handle Tab key to toggle input mode
  const handleInputModeToggle = useCallback(
    (value: T) => {
      const option = options.find(opt => opt.value === value);
      if (!option?.feedbackConfig) return;

      const { type } = option.feedbackConfig;
      const analyticsProps = {
        toolName: toolAnalyticsContext?.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        isMcp: toolAnalyticsContext?.isMcp ?? false,
      };

      if (type === 'accept') {
        if (acceptInputMode) {
          setAcceptInputMode(false);
          logEvent('tengu_accept_feedback_mode_collapsed', analyticsProps);
        } else {
          setAcceptInputMode(true);
          setAcceptFeedbackModeEntered(true);
          logEvent('tengu_accept_feedback_mode_entered', analyticsProps);
        }
      } else if (type === 'reject') {
        if (rejectInputMode) {
          setRejectInputMode(false);
          logEvent('tengu_reject_feedback_mode_collapsed', analyticsProps);
        } else {
          setRejectInputMode(true);
          setRejectFeedbackModeEntered(true);
          logEvent('tengu_reject_feedback_mode_entered', analyticsProps);
        }
      }
    },
    [options, acceptInputMode, rejectInputMode, toolAnalyticsContext],
  );

  // Handle selection
  const handleSelect = useCallback(
    (value: T) => {
      if (isDisabled) return;
      const option = options.find(opt => opt.value === value);
      if (!option) return;

      // Get feedback if applicable
      let feedback: string | undefined;
      if (option.feedbackConfig) {
        const rawFeedback = option.feedbackConfig.type === 'accept' ? acceptFeedback : rejectFeedback;
        const trimmedFeedback = rawFeedback.trim();

        if (trimmedFeedback) {
          feedback = trimmedFeedback;
        }

        // Log accept/reject submission with feedback context
        const analyticsProps = {
          toolName: toolAnalyticsContext?.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          isMcp: toolAnalyticsContext?.isMcp ?? false,
          has_instructions: !!trimmedFeedback,
          instructions_length: trimmedFeedback?.length ?? 0,
          entered_feedback_mode:
            option.feedbackConfig.type === 'accept' ? acceptFeedbackModeEntered : rejectFeedbackModeEntered,
        };

        if (option.feedbackConfig.type === 'accept') {
          logEvent('tengu_accept_submitted', analyticsProps);
        } else if (option.feedbackConfig.type === 'reject') {
          logEvent('tengu_reject_submitted', analyticsProps);
        }
      }

      onSelect(value, feedback);
    },
    [
      isDisabled,
      options,
      acceptFeedback,
      rejectFeedback,
      onSelect,
      toolAnalyticsContext,
      acceptFeedbackModeEntered,
      rejectFeedbackModeEntered,
    ],
  );

  // DualInk analog gold Mhy Mi({"confirm:cycleMode":w}) / File ERg.
  const handleCycleMode = useCallback(() => {
    const action = resolveConfirmCycleModeAction({
      yesInputMode: acceptInputMode,
      noInputMode: rejectInputMode,
    });
    if (action === 'collapse-yes') {
      setAcceptInputMode(false);
      const acceptOpt = options.find(opt => opt.feedbackConfig?.type === 'accept');
      if (acceptOpt) setFocusedValue(acceptOpt.value);
      return;
    }
    if (action === 'collapse-no') {
      setRejectInputMode(false);
      const rejectOpt = options.find(opt => opt.feedbackConfig?.type === 'reject');
      if (rejectOpt) setFocusedValue(rejectOpt.value);
      return;
    }
    cycleModeAction?.();
  }, [acceptInputMode, rejectInputMode, options, cycleModeAction]);

  // Register keybinding handlers for options that have a keybinding set
  const keybindingHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {};
    for (const opt of options) {
      if (opt.keybinding) {
        handlers[opt.keybinding] = () => handleSelect(opt.value);
      }
    }
    if (cycleModeAction) {
      handlers['confirm:cycleMode'] = handleCycleMode;
    }
    return handlers;
  }, [options, handleSelect, cycleModeAction, handleCycleMode]);

  useKeybindings(keybindingHandlers, { context: 'Confirmation' });

  // Handle cancel (Esc)
  const handleCancel = useCallback(() => {
    if (isDisabled) return;
    logEvent('tengu_permission_request_escape', {});
    // Increment escape count for attribution tracking
    setAppState(prev => ({
      ...prev,
      attribution: {
        ...prev.attribution,
        escapeCount: prev.attribution.escapeCount + 1,
      },
    }));
    onCancel?.();
  }, [isDisabled, onCancel, setAppState]);

  const select = (
    <Select
      options={selectOptions}
      inlineDescriptions
      isDisabled={isDisabled}
      onChange={handleSelect}
      onCancel={handleCancel}
      onFocus={value => {
        // Reset input mode when navigating away, but only if no text typed
        const newOption = options.find(opt => opt.value === value);
        if (newOption?.feedbackConfig?.type !== 'accept' && acceptInputMode && !acceptFeedback.trim()) {
          setAcceptInputMode(false);
        }
        if (newOption?.feedbackConfig?.type !== 'reject' && rejectInputMode && !rejectFeedback.trim()) {
          setRejectInputMode(false);
        }
        setFocusedValue(value);
      }}
      onInputModeToggle={handleInputModeToggle}
      onImagePaste={onImagePaste}
      pastedContents={pastedContents}
      onRemoveImage={onRemoveImage}
    />
  );

  return (
    <Box flexDirection="column">
      {typeof question === 'string' ? <Text dimColor={isDisabled}>{question}</Text> : question}
      {selectRef ? (
        <Box ref={selectRef} width="100%">
          {select}
        </Box>
      ) : (
        select
      )}
      {!hostChrome && (
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel{showTabHint && ' · Tab to amend'}</Text>
        </Box>
      )}
    </Box>
  );
}
