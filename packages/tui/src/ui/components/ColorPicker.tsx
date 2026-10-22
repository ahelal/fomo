import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, PALETTE_COLUMNS, colorName, normalizeHexColor, paletteIndex, pickerFallback, readableTextColor } from '@fomo/core';
import { pickerColor, type ColorPickerState } from '../hooks/useColorPicker.js';

const PANEL = '#161b22';
const BORDER = '#1c7cd6';
const ACCENT = '#58a6ff';
const MUTED = '#8b949e';
const TEXT = '#c9d1d9';
const BRIGHT = '#f0f6fc';
const ERROR = '#f85149';

interface Props {
  state: ColorPickerState;
  columns: number;
  rows: number;
}

/** One popup line; the panel color sits behind every character so the screen below doesn't show through. */
const Line = ({ children, color = TEXT, bold }: { children?: React.ReactNode; color?: string; bold?: boolean }) => (
  <Text backgroundColor={PANEL} color={color} bold={bold} wrap="truncate-end">{children ?? ' '}</Text>
);

function Swatch({ hex, width, mark }: { hex: string; width: number; mark?: string }) {
  if (!mark) return <Text backgroundColor={hex}>{' '.repeat(width)}</Text>;
  const left = Math.floor((width - 1) / 2);
  return (
    <Text backgroundColor={hex} color={readableTextColor(hex)} bold>
      {`${' '.repeat(left)}${mark}${' '.repeat(width - left - 1)}`}
    </Text>
  );
}

/**
 * The palette grid. The highlighted swatch is framed: ▕ ▏ at its sides and, with `airy` spacing,
 * ▁ ▔ above and below it. `•` marks the color it had when the picker opened.
 */
function Grid({ selected, shown, width, airy }: { selected: number; shown: number; width: number; airy: boolean }) {
  const rowsN = Math.ceil(PALETTE.length / PALETTE_COLUMNS);
  // A custom color (index -1) frames no swatch; NaN never equals a row or column.
  const selRow = selected >= 0 ? Math.floor(selected / PALETTE_COLUMNS) : NaN;
  const selCol = selected >= 0 ? selected % PALETTE_COLUMNS : NaN;
  const edge = (row: number, char: string) => (
    <Line key={`edge${row}${char}`} color={BRIGHT}>
      {' '.repeat(1 + selCol * (width + 1))}{char.repeat(width)}
    </Line>
  );
  const lines: React.ReactNode[] = [];
  for (let r = 0; r < rowsN; r++) {
    if (airy) {
      if (selRow === r) lines.push(edge(r, '▁'));
      else if (selRow === r - 1) lines.push(edge(r, '▔'));
      else lines.push(<Line key={`gap${r}`} />);
    }
    const cells: React.ReactNode[] = [];
    for (let c = 0; c < PALETTE_COLUMNS; c++) {
      const i = r * PALETTE_COLUMNS + c;
      const color = PALETTE[i];
      const gap = selRow === r && selCol === c ? '▕' : selRow === r && selCol === c - 1 ? '▏' : ' ';
      cells.push(<Text key={`g${c}`} color={BRIGHT}>{gap}</Text>);
      if (color) cells.push(<Swatch key={`s${c}`} hex={color.hex} width={width} mark={i === selected ? '✓' : i === shown ? '•' : undefined} />);
    }
    cells.push(<Text key="end" color={BRIGHT}>{selRow === r && selCol === PALETTE_COLUMNS - 1 ? '▏' : ' '}</Text>);
    lines.push(<Line key={`row${r}`}>{cells}</Line>);
  }
  if (airy) lines.push(selRow === rowsN - 1 ? edge(rowsN, '▔') : <Line key="gapEnd" />);
  return <>{lines}</>;
}

/** The color picker popup, centered over the screen. */
export function ColorPicker({ state, columns, rows }: Props) {
  const swatch = columns >= 72 ? 5 : columns >= 50 ? 3 : 2;
  const airy = rows >= 28;
  const fallbackLabel = state.fallbackLabel ?? 'default';
  const typing = state.hexDraft !== undefined;
  const hint = `←↑↓→ move  ↵ apply  # hex  d ${fallbackLabel}  Esc cancel`;
  const hexHint = 'type #rrggbb  ↵ apply  Tab preview  ^U clear  Esc back';
  const gridW = PALETTE_COLUMNS * (swatch + 1) + 1;
  // Wide enough for the grid and both hints, so it doesn't jump when typing a hex color.
  const width = Math.min(columns, Math.max(gridW, hint.length, hexHint.length) + 6);
  const current = pickerColor(state);
  const own = normalizeHexColor(state.color);
  const fallback = pickerFallback(state);
  const shownIndex = paletteIndex(own ?? fallback);

  const body = (
    <>
      <Line color={ACCENT} bold>{`Pick a color · ${state.title}`}</Line>
      {!airy && <Line />}
      <Grid selected={state.index} shown={shownIndex} width={swatch} airy={airy} />
      <Line />
      <Line>
        <Text color={current}>{'██████'}</Text>
        <Text color={BRIGHT} bold>{`  ${colorName(current)}`}</Text>
        <Text color={MUTED}>{`  ${current}${state.index < 0 ? '  (custom)' : ''}`}</Text>
      </Line>
      <Line color={MUTED}>
        {'Was     '}
        {own
          ? <><Text color={own}>{'■ '}</Text><Text color={TEXT}>{`${colorName(own)} ${own}`}</Text></>
          : <><Text color={fallback}>{'■ '}</Text><Text color={TEXT}>{`${fallbackLabel} (${colorName(fallback)})`}</Text></>}
      </Line>
      {state.sample !== undefined && (
        <Line color={MUTED}>{'Sample  '}<Text color={current} bold>{state.sample}</Text></Line>
      )}
      {typing && (
        <Line color={MUTED}>
          {'Hex     '}
          <Text color={BRIGHT}>{state.hexDraft}</Text>
          <Text backgroundColor={ACCENT} color="#0d1117">{'▋'}</Text>
        </Line>
      )}
      {state.error && <Line color={ERROR}>{`⚠ ${state.error}`}</Line>}
      <Line />
      <Line color={MUTED}>{typing ? hexHint : hint}</Line>
    </>
  );
  const height = 2 + 1 + (airy ? 9 : 5) + 3 + (state.sample !== undefined ? 1 : 0) + (typing ? 1 : 0) + (state.error ? 1 : 0) + 2;

  return (
    <Box position="absolute" width={columns} height={rows} alignItems="center" justifyContent="center">
      <Box width={width} height={height} flexDirection="column">
        <Box position="absolute" flexDirection="column">
          {Array.from({ length: height }, (_, i) => <Text key={i} backgroundColor={PANEL}>{' '.repeat(width)}</Text>)}
        </Box>
        <Box width={width} height={height} flexDirection="column" borderStyle="round" borderColor={BORDER} paddingX={2}>
          {body}
        </Box>
      </Box>
    </Box>
  );
}
