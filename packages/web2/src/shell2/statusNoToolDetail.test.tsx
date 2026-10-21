/**
 * Owner ruling 0.1.8.4: the Focused/Detailed tool-call control lives in Settings > General only, never in the
 * status bar. The bar draws no tool-detail control at any width; the Settings row still switches the mode.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, createStore } from '../state';
import { StatusBar } from './StatusBar';

describe('the status bar has no Focused/Detailed control', () => {
  it('draws neither the full toggle nor the compact one', () => {
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <StatusBar />
      </StoreProvider>,
    );
    expect(screen.queryByTestId('s2-tool-detail')).toBeNull();
    expect(screen.queryByTestId('s2-tool-detail-c')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Tool calls' })).toBeNull();
  });
});
