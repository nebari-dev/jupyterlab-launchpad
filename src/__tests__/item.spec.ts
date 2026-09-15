jest.mock('../icons', () => ({
  codeServerIcon: {},
  nebiIcon: {}
}));

import type { CommandRegistry } from '@lumino/commands';
import type { ReadonlyJSONObject } from '@lumino/coreutils';
import { Item } from '../item';
import type { IFavoritesDatabase, ILastUsedDatabase } from '../types';

function createItem(options: {
  command: string;
  category?: string;
  metadata?: ReadonlyJSONObject;
}): Item {
  const commands = {
    iconClass: () => '',
    icon: () => undefined,
    caption: () => '',
    label: () => 'Python 3 (ipykernel)',
    execute: jest.fn(() => Promise.resolve())
  } as unknown as CommandRegistry;

  const lastUsedDatabase = {
    ready: Promise.resolve(),
    get: () => null,
    recordAsUsed: jest.fn(() => Promise.resolve()),
    recordAsUsedNow: jest.fn(() => Promise.resolve()),
    changed: null as never
  } satisfies ILastUsedDatabase;

  const favoritesDatabase = {
    ready: Promise.resolve(),
    get: () => false,
    set: jest.fn(() => Promise.resolve()),
    changed: null as never
  } satisfies IFavoritesDatabase;

  return new Item({
    commands,
    cwd: '',
    lastUsedDatabase,
    favoritesDatabase,
    item: {
      command: options.command,
      category: options.category,
      args: { kernelName: 'python3' },
      metadata: options.metadata
    }
  });
}

describe('Item', () => {
  it('adds review-friendly defaults for built-in kernel rows', () => {
    const item = createItem({
      command: 'notebook:create-new',
      category: 'Notebook'
    });

    expect(item.metadata?.kernel).toMatchObject({
      nebi_version: 'Built in',
      nebi_status: 'ready'
    });
  });

  it('keeps real Nebi metadata unchanged', () => {
    const item = createItem({
      command: 'notebook:create-new',
      category: 'Notebook',
      metadata: {
        kernel: {
          nebi_status: 'not-pulled',
          nebi_remote_version: '2.0.0'
        }
      }
    });

    expect(item.metadata?.kernel).toMatchObject({
      nebi_status: 'not-pulled',
      nebi_remote_version: '2.0.0'
    });
    expect(item.metadata?.kernel).not.toHaveProperty('nebi_version');
  });
});
