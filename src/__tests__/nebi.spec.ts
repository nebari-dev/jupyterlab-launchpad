import type { ReadonlyJSONObject } from '@lumino/coreutils';
import { nebiLogoReason } from '../components/nebi';

describe('nebiLogoReason', () => {
  const kernelMeta = (value: Record<string, unknown>): ReadonlyJSONObject =>
    value as ReadonlyJSONObject;

  it('derives reason from state and not_ready_reason for blocking states', () => {
    expect(
      nebiLogoReason(
        kernelMeta({
          nebi_state: 'local-not-installed',
          nebi_not_ready_reason: 'environment-not-installed'
        })
      )
    ).toBe('environment-not-installed');
  });

  it('returns undefined for ready and outdated states', () => {
    expect(
      nebiLogoReason(
        kernelMeta({
          nebi_state: 'ready',
          nebi_not_ready_reason: 'should-not-show'
        })
      )
    ).toBeUndefined();

    expect(
      nebiLogoReason(
        kernelMeta({
          nebi_state: 'outdated',
          nebi_not_ready_reason: 'should-not-show'
        })
      )
    ).toBeUndefined();
  });
});
