import { describe, expect, it, vi } from 'vitest';
import type { Update } from '../types.js';
import { similarityClues } from '../digest/similarity.js';
import { refineGroupingGuidance } from '../digest/feedback.js';
import { buildPlanPrompt, DIGEST_PLAN_SYSTEM_PROMPT } from '../digest/prompt.js';

function item(id: string, title: string, content = '', source = 'publisher'): Update {
  return {
    id, title, content, source, status: 'unread', saved: false,
    url: `https://example.com/${id}`, datePublished: '2026-01-01', dateAdded: '2026-01-01',
  };
}

describe('lexical grouping evidence', () => {
  it('finds a product relationship across sources without turning it into an authoritative group', () => {
    const items = [
      item('a', 'Copilot CLI extensions', 'Terminal agents and extension support', 'first'),
      item('b', 'Copilot CLI plugins', 'Terminal extension integration', 'second'),
      item('c', 'PostgreSQL vacuum tuning', 'Database index maintenance', 'first'),
    ];
    const clues = similarityClues(items);
    expect(clues).toEqual([expect.objectContaining({ left: 'a', right: 'b', terms: expect.arrayContaining(['copilot cli']) })]);
    expect(clues[0]!.score).toBeGreaterThan(0.12);
    expect(clues[0]!.score).toBeLessThanOrEqual(1);
    const prompt = buildPlanPrompt(items, []);
    expect(prompt.prompt).toContain('i1 ~ i2');
    expect(prompt.prompt).toContain('wink-nlp BM25 + cosine');
    expect(prompt.system).toContain('disagree when products or themes differ');
    expect(prompt.system).toContain('no target group count or size');
  });

  it('ignores shared source names, common words and numbers', () => {
    expect(similarityClues([
      item('a', 'New software release 1.2', '', 'same publisher'),
      item('b', 'Software updates 2.0', '', 'same publisher'),
    ])).toEqual([]);
    const original = [item('a', 'Database indexes'), item('b', 'Database indexes')];
    const differentSources = original.map((update, i) => ({ ...update, source: `other-${i}` }));
    expect(similarityClues(original)).toEqual(similarityClues(differentSources));
  });

  it('uses body evidence and preserves punctuation in product names', () => {
    const clues = similarityClues([
      item('a', 'Compiler changes', '<p>C++ .NET VS Code integration</p>'),
      item('b', 'Editor tooling', 'C++ .NET VS Code integration'),
    ]);
    expect(clues[0]?.terms).toEqual(expect.arrayContaining(['c++', '.net']));
  });

  it('is deterministic, finite and handles empty inputs', () => {
    expect(similarityClues([])).toEqual([]);
    expect(similarityClues([item('a', ''), item('b', '')])).toEqual([]);
    const updates = Array.from({ length: 20 }, (_, n) => item(String(n), `Copilot CLI version ${n}`));
    const clues = similarityClues(updates);
    expect(similarityClues(updates)).toEqual(clues);
    expect(clues.length).toBeLessThanOrEqual(updates.length * 3);
    expect(clues.every((clue) => Number.isFinite(clue.score))).toBe(true);
  });

  it('ranks matching product releases above same-vendor articles on other products', () => {
    const updates = [
      item('cli', 'GitHub Copilot CLI extensions', 'Terminal plugins for command line agents'),
      item('release', 'GitHub Copilot CLI plugin support', 'Extensions for terminal command line agents'),
      item('billing', 'GitHub Copilot billing metrics', 'Enterprise costs and monthly spending reports'),
      item('actions', 'GitHub Actions runner images', 'Hosted runners for workflow automation'),
    ];
    const clues = similarityClues(updates);
    const cliPairs = clues.filter((clue) => clue.left === 'cli');
    expect(cliPairs.find((clue) => clue.right === 'release')!.score).toBeGreaterThan(
      cliPairs.find((clue) => clue.right === 'billing')!.score,
    );
    expect(cliPairs.find((clue) => clue.right === 'release')!.score).toBeGreaterThan(
      cliPairs.find((clue) => clue.right === 'actions')!.score,
    );
  });

  it('does not treat empty articles as similar or emit non-finite evidence in mixed corpora', () => {
    const clues = similarityClues([
      item('empty', ''),
      item('cli1', 'Copilot CLI extensions'),
      item('cli2', 'Copilot CLI extensions'),
    ]);
    expect(clues).toHaveLength(1);
    expect(clues[0]).toMatchObject({ left: 'cli1', right: 'cli2', score: 1 });
    expect(similarityClues([item('single', 'Copilot CLI')])).toEqual([]);
  });
});

describe('grouping feedback', () => {
  it('uses a grouping-only prompt and returns a suggestion, not a stored change', async () => {
    const generateJson = vi.fn(async () => ({ guidance: ' Keep CLI separate from editors. ' }));
    expect(await refineGroupingGuidance({ generateJson }, 'Keep release streams together', 'Separate CLI')).toBe('Keep CLI separate from editors.');
    expect(generateJson).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('not importance or summary style'),
      prompt: expect.stringContaining('"current":"Keep release streams together"'),
    }));
    expect(DIGEST_PLAN_SYSTEM_PROMPT).not.toContain('3–15');
  });

  it.each([null, {}, { guidance: '' }, { guidance: 42 }, { guidance: 'x'.repeat(1001) }])('rejects invalid guidance: %j', async (raw) => {
    await expect(refineGroupingGuidance({ generateJson: async () => raw }, '', 'feedback')).rejects.toThrow('invalid grouping guidance');
  });
});
