import figures from 'figures';
import React, { useRef } from 'react';
import { Box, Text, useDeclaredCursor, useTerminalSize, type ClickEvent, type DOMElement } from '@anthropic/ink';
import {
  leftoverG5PromptColumn,
  leftoverNnDtWidth,
  leftoverNnFacts,
  leftoverNnFromOptions,
  leftoverNnIconWidth,
  leftoverNnLiveWidth,
  leftoverVmnPaintSelected,
  leftoverVmnRn,
  LeftoverNnDtContext,
} from '../FullscreenLayout.js';
import type { PastedContent } from '../../utils/config.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import type { OptionWithDescription } from './select.js';
import { SelectInputOption } from './select-input-option.js';
import { SelectOption } from './select-option.js';
import { useMultiSelectState } from './use-multi-select-state.js';
import { useStrayClickGuard } from './use-stray-click.js';

export type SelectMultiProps<T> = {
  readonly isDisabled?: boolean;
  readonly visibleOptionCount?: number;
  readonly options: OptionWithDescription<T>[];
  readonly defaultValue?: T[];
  readonly onCancel: () => void;
  readonly onChange?: (values: T[]) => void;
  readonly onFocus?: (value: T) => void;
  readonly focusValue?: T;
  /**
   * Text for the submit button. When provided, a submit button is shown and
   * Enter toggles selection (submit only fires when the button is focused).
   * When omitted, Enter submits directly and Space toggles selection.
   */
  readonly submitButtonText?: string;
  /**
   * Callback when user submits. Receives the currently selected values.
   */
  readonly onSubmit?: (values: T[]) => void;
  /**
   * When true, hides the numeric indexes next to each option.
   */
  readonly hideIndexes?: boolean;
  /**
   * densable VMn `refuseInput`.
   */
  readonly refuseInput?: () => boolean;
  /**
   * densable VMn `DZe` analog — SR radio arrow nav (default false).
   */
  readonly arrowNav?: boolean;
  /**
   * Callback when user presses down from the last item (submit button).
   * If provided, navigation will not wrap to the first item.
   */
  readonly onDownFromLastItem?: () => void;
  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  readonly onUpFromFirstItem?: () => void;
  /**
   * Focus the last option initially instead of the first.
   */
  readonly initialFocusLast?: boolean;
  /**
   * Callback to open external editor for editing input option values.
   * When provided, ctrl+g will trigger this callback in input options
   * with the current value and a setter function to update the internal state.
   */
  readonly onOpenEditor?: (currentValue: string, setValue: (value: string) => void) => void;
  readonly onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void;
  readonly pastedContents?: Record<number, PastedContent>;
  readonly onRemoveImage?: (id: number) => void;
};

export function SelectMulti<T>({
  isDisabled = false,
  visibleOptionCount = 5,
  options,
  defaultValue = [],
  onCancel,
  onChange,
  onFocus,
  focusValue,
  submitButtonText,
  onSubmit,
  onDownFromLastItem,
  onUpFromFirstItem,
  initialFocusLast,
  onOpenEditor,
  hideIndexes = false,
  refuseInput,
  arrowNav = false,
  onImagePaste,
  pastedContents,
  onRemoveImage,
}: SelectMultiProps<T>): React.ReactNode {
  const state = useMultiSelectState<T>({
    isDisabled,
    visibleOptionCount,
    options,
    defaultValue,
    onChange,
    onCancel,
    onFocus,
    focusValue,
    submitButtonText,
    onSubmit,
    onDownFromLastItem,
    onUpFromFirstItem,
    initialFocusLast,
    hideIndexes,
    refuseInput,
    arrowNav,
  });

  const leftoverHostRef = useRef<DOMElement | null>(null);
  const leftoverNnDt = useRef(new Set<DOMElement>()).current;
  const leftoverColumns = useTerminalSize().columns;
  const leftoverNn = leftoverNnFromOptions(
    leftoverNnLiveWidth(
      leftoverHostRef.current?.yogaNode?.getComputedWidth() ?? 0,
      leftoverColumns,
      leftoverNnDtWidth(leftoverNnDt),
    ),
    options.map(option => ({
      iconWidth: leftoverNnIconWidth(option.icon),
      name: typeof option.label === 'string' ? option.label : '',
      facts: leftoverNnFacts(option.meta),
    })),
  );
  const maxIndexWidth = options.length.toString().length;
  const leftoverCursorRef = useDeclaredCursor({
    line: 0,
    column: leftoverG5PromptColumn(state.leftoverVmnPrompt ?? ''),
    active: Boolean(state.leftoverSrRadio && state.leftoverVmnPrompt && state.leftoverVmnCursorOn),
  });
  const isStrayClick = useStrayClickGuard();
  const optionOnClick = (option: OptionWithDescription<T>) => {
    if (isDisabled || option.disabled === true) {
      return undefined;
    }
    return (event: ClickEvent) => {
      if (isStrayClick(event)) {
        return;
      }
      if (option.type === 'input') {
        state.focusOption(option.value);
      } else {
        state.toggleValue(option.value);
      }
    };
  };

  if (state.leftoverSrRadio) {
    return (
      <Box ref={leftoverHostRef} flexDirection="column" tabIndex={0} onKeyDown={state.leftoverBindKeyDown}>
        {options.map((option, index) => {
          const selected = leftoverVmnPaintSelected(
            state.leftoverVmnToggle,
            index,
            state.selectedValues.includes(option.value),
          );
          const focused = state.leftoverVmnArrowIndex === index && !isDisabled;
          const label = typeof option.label === 'string' ? option.label : String(index + 1);
          return (
            <Text key={String(option.value)} color={focused ? 'suggestion' : undefined}>
              {leftoverVmnRn(index + 1, label, option.description, selected, option.disabled === true)}
            </Text>
          );
        })}
        {state.leftoverVmnError ? <Text>{state.leftoverVmnError}</Text> : null}
        {state.leftoverVmnPrompt ? (
          <Box ref={leftoverCursorRef}>
            <Text dimColor>{state.leftoverVmnPrompt}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <LeftoverNnDtContext value={leftoverNnDt}>
      <Box ref={leftoverHostRef} flexDirection="column">
        <Box flexDirection="column">
          {state.visibleOptions.map((option, index) => {
            const isOptionFocused = !isDisabled && state.focusedValue === option.value && !state.isSubmitFocused;
            const isSelected = state.selectedValues.includes(option.value);

            const isFirstVisibleOption = option.index === state.visibleFromIndex;
            const isLastVisibleOption = option.index === state.visibleToIndex - 1;
            const areMoreOptionsBelow = state.visibleToIndex < options.length;
            const areMoreOptionsAbove = state.visibleFromIndex > 0;

            const i = state.visibleFromIndex + index + 1;

            if (option.type === 'input') {
              const inputValue = state.inputValues.get(option.value) || '';

              return (
                <Box key={String(option.value)} gap={1}>
                  <SelectInputOption
                    option={option}
                    isFocused={isOptionFocused}
                    isSelected={false /* We show selection state differently for multi-select */}
                    shouldShowDownArrow={areMoreOptionsBelow && isLastVisibleOption}
                    shouldShowUpArrow={areMoreOptionsAbove && isFirstVisibleOption}
                    maxIndexWidth={maxIndexWidth}
                    index={i}
                    inputValue={inputValue}
                    onInputChange={value => {
                      state.updateInputValue(option.value, value);
                    }}
                    onSubmit={() => {}} /* We handle submit higher up */
                    onExit={() => {
                      onCancel();
                    }}
                    layout="compact"
                    onOpenEditor={onOpenEditor}
                    onImagePaste={onImagePaste}
                    pastedContents={pastedContents}
                    onRemoveImage={onRemoveImage}
                    onClick={optionOnClick(option)}
                  >
                    <Text color={isSelected ? 'success' : undefined}>[{isSelected ? figures.tick : ' '}] </Text>
                  </SelectInputOption>
                </Box>
              );
            }

            return (
              <Box key={String(option.value)} gap={1}>
                <SelectOption
                  isFocused={isOptionFocused}
                  isSelected={false /* We show selection state differently for multi-select */}
                  shouldShowDownArrow={areMoreOptionsBelow && isLastVisibleOption}
                  shouldShowUpArrow={areMoreOptionsAbove && isFirstVisibleOption}
                  description={option.description}
                  onClick={optionOnClick(option)}
                  icon={leftoverNn ? option.icon : undefined}
                  meta={leftoverNn ? leftoverNnFacts(option.meta) : undefined}
                  iconWidth={leftoverNn?.iconWidth}
                  nameWidth={leftoverNn?.nameWidth}
                  factsWidth={leftoverNn?.factsWidth}
                >
                  {!hideIndexes && <Text dimColor>{`${i}.`.padEnd(maxIndexWidth)}</Text>}
                  <Text color={isSelected ? 'success' : undefined}>[{isSelected ? figures.tick : ' '}]</Text>
                  <Text color={isOptionFocused ? 'suggestion' : undefined}>{option.label}</Text>
                </SelectOption>
              </Box>
            );
          })}
        </Box>
        {submitButtonText && onSubmit && (
          <Box marginTop={0} gap={1}>
            {state.isSubmitFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
            <Box marginLeft={3}>
              <Text color={state.isSubmitFocused ? 'suggestion' : undefined} bold={true}>
                {submitButtonText}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </LeftoverNnDtContext>
  );
}
