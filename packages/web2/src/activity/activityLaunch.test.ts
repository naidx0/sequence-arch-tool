import { describe, expect, it } from 'vitest';

import { setActivityLaunch, takeActivityLaunch } from './activityLaunch';

describe('activityLaunch (P4)', () => {
  it('hands Start a workflow a one-shot draft to Activity', () => {
    setActivityLaunch({ name: 'Workflow', instruction: 'do the thing' });
    expect(takeActivityLaunch()).toEqual({ name: 'Workflow', instruction: 'do the thing' });
    expect(takeActivityLaunch()).toBeNull();
  });
});
