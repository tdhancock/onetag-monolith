//
// target: __tests__/lib/projectDetails.test.ts
//
// Project details (ONE-140), the pure logic: the templates, the rules each
// value is checked against, what saving writes (never an empty value), how a
// date travels between the picker and the database, how the page shows a
// detail, and the ordered-row diff shared with product specs.

// The diff is pure, but its module also holds the writes.
jest.mock('../../services/supabase.native', () => ({ supabase: {} }));

import {
  DETAIL_KINDS,
  dateFromDetailValue,
  detailDisplayValue,
  detailDraftErrors,
  detailDraftsFrom,
  detailDraftsFromTemplate,
  detailEditsFrom,
  detailValueError,
  detailValueFromDate,
  isCalendarDate,
  newDetailDraft,
  PROJECT_DETAIL_TEMPLATES,
  savedDetailValue,
  templateSummary,
  type ProjectDetailDraft,
} from '../../lib/screens/projectDetails';
import { EMPTY_PROJECT_DRAFT, projectDraftErrors, projectDraftValid, projectEditsFrom } from '../../lib/screens/projects';
import { orderedRowChanges } from '../../services/orderedRows';
import type { ProjectDetail, ProjectDetailInput } from '../../features/projects';

const template = (name: string) => PROJECT_DETAIL_TEMPLATES.find((t) => t.name === name)!;
const draft = (overrides: Partial<ProjectDetailDraft>): ProjectDetailDraft => ({
  key: 'k',
  label: 'Label',
  kind: 'text',
  value: '',
  ...overrides,
});

describe('the templates', () => {
  it('are offered in order, each label with its kind, text where none is given', () => {
    expect(PROJECT_DETAIL_TEMPLATES.map((t) => t.name)).toEqual(['Home', 'HVAC', 'Appliance', 'Water heater', 'Vehicle']);
    expect(template('HVAC').details).toEqual([
      { label: 'Make', kind: 'text' },
      { label: 'Model number', kind: 'text' },
      { label: 'Serial number', kind: 'text' },
      { label: 'Filter size', kind: 'text' },
      { label: 'Installed', kind: 'date' },
      { label: 'Warranty until', kind: 'date' },
    ]);
    expect(template('Water heater').details).toContainEqual({ label: 'Capacity (gal)', kind: 'number' });
    expect(template('Vehicle').details).toContainEqual({ label: 'Year', kind: 'number' });
    expect(template('Home').details).toEqual([
      { label: 'Year built', kind: 'number' },
      { label: 'Square feet', kind: 'number' },
    ]);
  });

  it("add their labels with empty values, each with its own key, listed under the template's name", () => {
    const drafts = detailDraftsFromTemplate(template('Appliance'));
    expect(drafts.map((d) => d.label)).toEqual(['Make', 'Model number', 'Serial number', 'Purchased', 'Warranty until']);
    expect(drafts.every((d) => d.value === '' && d.id === undefined)).toBe(true);
    expect(new Set(drafts.map((d) => d.key)).size).toBe(drafts.length);
    expect(templateSummary(template('Home'))).toBe('Year built, Square feet');
  });

  it('offer the four kinds to add, in order', () => {
    expect(DETAIL_KINDS.map((k) => k.value)).toEqual(['text', 'number', 'date', 'link']);
    expect(newDetailDraft('date')).toMatchObject({ label: '', kind: 'date', value: '' });
  });
});

describe('a value', () => {
  it('is a date that exists: 2026-02-30 is flagged', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2027-02-29')).toBe(false);
    expect(isCalendarDate('2026-2-3')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(detailDraftErrors([draft({ kind: 'date', value: '2026-02-30' })])['details[0].value']).toMatch(/date that exists/);
  });

  it('is a number like the database takes', () => {
    expect(detailValueError('number', '40')).toBeNull();
    expect(detailValueError('number', '-2.5')).toBeNull();
    expect(detailValueError('number', ' 12 ')).toBeNull();
    expect(detailValueError('number', '1.')).toMatch(/number/);
    expect(detailValueError('number', '1,200')).toMatch(/number/);
    expect(detailValueError('number', '12a')).toMatch(/number/);
  });

  it('is a link, given https:// when it was typed without a scheme', () => {
    expect(savedDetailValue('link', ' example.com/manual ')).toBe('https://example.com/manual');
    expect(savedDetailValue('link', 'HTTPS://Example.com')).toBe('https://Example.com');
    expect(savedDetailValue('link', 'http://example.com')).toBe('http://example.com');
    expect(detailValueError('link', 'example.com')).toBeNull();
    expect(detailValueError('link', 'ftp://example.com')).toMatch(/web link/);
    expect(detailValueError('link', 'two words')).toMatch(/web link/);
  });

  it('is anything for text, and fine empty of any kind, since an empty one is not saved', () => {
    expect(detailValueError('text', '16x25x1')).toBeNull();
    for (const { value: kind } of DETAIL_KINDS) expect(detailValueError(kind, '  ')).toBeNull();
  });

  it('needs a label beside it', () => {
    const errors = detailDraftErrors([draft({ label: ' ', value: 'XR-200' }), draft({ label: '', value: '' })]);
    expect(errors['details[0].value']).toBe('Give this detail a label too.');
    expect(errors['details[1].value']).toBeNull();
  });

  it('keeps a project from saving while one is wrong, and says which', () => {
    const project = { ...EMPTY_PROJECT_DRAFT, name: 'Furnace', details: [draft({ kind: 'number', value: 'lots' })] };
    expect(projectDraftValid(project)).toBe(false);
    expect(projectDraftErrors(project)).toMatchObject({ name: null, 'details[0].value': 'A number, like 40 or 2.5.' });
    expect(projectDraftValid({ ...project, details: [draft({ kind: 'number', value: '40' })] })).toBe(true);
  });
});

describe('saving details', () => {
  it('writes only those with a value: the HVAC template with only Model number filled saves one', () => {
    const drafts = detailDraftsFromTemplate(template('HVAC'));
    drafts[1]!.value = ' XR-200 ';
    expect(detailEditsFrom(drafts)).toEqual([{ label: 'Model number', kind: 'text', value: 'XR-200' }]);
  });

  it('keeps a stored detail its id, and an edit carries them in order', () => {
    const stored = [
      { id: 'd1', label: 'Make', kind: 'text' as const, value: 'Acme', sortOrder: 0 },
      { id: 'd2', label: 'Manual', kind: 'link' as const, value: 'https://acme.test/m', sortOrder: 1 },
    ];
    const drafts = detailDraftsFrom(stored);
    expect(drafts.map((d) => d.key)).toEqual(['d1', 'd2']);
    const edits = projectEditsFrom({ ...EMPTY_PROJECT_DRAFT, name: 'Furnace', details: [drafts[1]!, drafts[0]!] });
    expect(edits.details.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('turns an edit into the fewest writes, a change of kind among them', () => {
    const stored: ProjectDetail[] = [
      { id: 'd1', label: 'Make', kind: 'text', value: 'Acme', sortOrder: 0 },
      { id: 'd2', label: 'Installed', kind: 'text', value: '2026-01-02', sortOrder: 1 },
      { id: 'd3', label: 'Gone', kind: 'text', value: 'x', sortOrder: 2 },
    ];
    const fields = ['label', 'kind', 'value'] as const;
    expect(
      orderedRowChanges<ProjectDetailInput>(
        stored,
        [
          { id: 'd1', label: 'Make', kind: 'text', value: 'Acme' },
          { id: 'd2', label: 'Installed', kind: 'date', value: '2026-01-02' },
          { label: 'Filter size', kind: 'text', value: '16x25x1' },
        ],
        fields,
      ),
    ).toEqual({
      inserts: [{ label: 'Filter size', kind: 'text', value: '16x25x1', sortOrder: 2 }],
      updates: [{ id: 'd2', label: 'Installed', kind: 'date', value: '2026-01-02', sortOrder: 1 }],
      removals: ['d3'],
    });
  });
});

describe('a date', () => {
  it('goes from the picker to the database as the day picked, in the device calendar', () => {
    expect(detailValueFromDate(new Date(2026, 2, 4, 23, 30))).toBe('2026-03-04');
    expect(detailValueFromDate(dateFromDetailValue('2026-12-31'))).toBe('2026-12-31');
  });

  it('starts the picker on today when there is none yet', () => {
    const today = new Date(2026, 9, 6);
    expect(dateFromDetailValue('', today)).toBe(today);
  });
});

describe('on the project page', () => {
  it("shows a date in the device's locale, a link without its scheme, and the rest as stored", () => {
    expect(detailDisplayValue({ kind: 'date', value: '2026-03-04' }, 'en-US')).toBe('March 4, 2026');
    expect(detailDisplayValue({ kind: 'link', value: 'https://acme.test/manual/' })).toBe('acme.test/manual');
    expect(detailDisplayValue({ kind: 'number', value: '1987' })).toBe('1987');
  });
});
