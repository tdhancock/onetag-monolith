//
// target: __tests__/lib/nestedProjects.test.ts
//
// Projects inside a project (ONE-134), the pure logic: what "Part of" offers,
// what a profile's tab lists, what deleting a house says, the create route
// that starts inside a project, and how the tag picker names a project inside
// another.

import {
  deleteProjectConfirm,
  NOT_PART_OF_ANYTHING,
  parentChoices,
  partOfLabel,
  partOfText,
  projectCreateRoute,
  topLevelProjects,
} from '../../lib/screens/projects';
import { destinationSections } from '../../lib/screens/tags';

const HOUSE = { id: 'pj-house', name: 'House', parentProjectId: null };
const GARAGE = { id: 'pj-garage', name: 'Garage', parentProjectId: null };
const FURNACE = { id: 'pj-furnace', name: 'Furnace', parentProjectId: 'pj-house' };

describe('Part of', () => {
  it('offers the profile\'s top-level projects, never one inside another', () => {
    expect(parentChoices([HOUSE, FURNACE, GARAGE])).toEqual([
      { id: 'pj-house', name: 'House' },
      { id: 'pj-garage', name: 'Garage' },
    ]);
  });

  it('never offers a project as its own parent', () => {
    expect(parentChoices([HOUSE, GARAGE], 'pj-house')).toEqual([{ id: 'pj-garage', name: 'Garage' }]);
  });

  it('reads the chosen parent by name, or None', () => {
    const choices = parentChoices([HOUSE, GARAGE]);
    expect(partOfLabel(choices, 'pj-house')).toBe('House');
    expect(partOfLabel(choices, null)).toBe(NOT_PART_OF_ANYTHING);
    expect(partOfLabel(choices, 'pj-gone')).toBe(NOT_PART_OF_ANYTHING);
    expect(partOfText('House')).toBe('Part of House');
  });
});

describe("a profile's projects", () => {
  it('are its top-level ones; what is inside a house is reached through the house', () => {
    expect(topLevelProjects([HOUSE, FURNACE, GARAGE]).map((p) => p.id)).toEqual(['pj-house', 'pj-garage']);
  });
});

describe('deleting a project that holds others', () => {
  it('says how many go with it', () => {
    expect(deleteProjectConfirm({ name: 'House' }, 4).body).toMatch(/^This also deletes the 4 projects inside it\. /);
    expect(deleteProjectConfirm({ name: 'House' }, 1).body).toMatch(/^This also deletes the 1 project inside it\. /);
  });

  it('says nothing of it when it holds none', () => {
    expect(deleteProjectConfirm({ name: 'Shed' }).body).not.toContain('inside it');
  });
});

describe('the create route', () => {
  it('starts inside a project when given one, and on its own otherwise', () => {
    expect(projectCreateRoute('pj-house')).toEqual({ pathname: '/project/create', params: { parent: 'pj-house' } });
    expect(projectCreateRoute()).toEqual({ pathname: '/project/create', params: {} });
  });
});

describe('the tag destination picker', () => {
  it('offers a project inside another as "in" its parent, beside the parent itself', () => {
    const projects = destinationSections([], [], [HOUSE, FURNACE]).find((section) => section.kind === 'project')!;
    expect(projects.options.map((option) => [option.title, option.subtitle])).toEqual([
      ['House', 'Project'],
      ['Furnace', 'Project · in House'],
    ]);
  });
});
