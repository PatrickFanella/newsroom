import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentTiming } from './SegmentTiming';
afterEach(cleanup);
describe('segment target editing', () => {
  it('saves a clear target explicitly as null', async () => {
    const save=vi.fn().mockResolvedValue(undefined); const user=userEvent.setup(); render(<SegmentTiming name="Opening" minutes={10} canCurate onSave={save}/>);
    await user.click(screen.getByRole('button',{ name: 'Set target for Opening' })); await user.clear(screen.getByRole('spinbutton',{ name: 'Target minutes for Opening' })); await user.click(screen.getByRole('button',{ name: 'Save target' })); expect(save).toHaveBeenCalledWith(null);
  });
  it('keeps the target draft on failure', async () => {
    const save=vi.fn().mockRejectedValue(new Error('fixture')); const user=userEvent.setup(); render(<SegmentTiming name="Opening" minutes={null} canCurate onSave={save}/>);
    await user.click(screen.getByRole('button',{ name: 'Set target for Opening' })); await user.type(screen.getByRole('spinbutton',{ name: 'Target minutes for Opening' }),'15'); await user.click(screen.getByRole('button',{ name: 'Save target' })); expect(await screen.findByRole('alert')).toHaveTextContent('Could not save timing target'); expect(screen.getByRole('spinbutton')).toHaveValue(15);
  });
  it('shows a read-only target for viewers', () => { render(<SegmentTiming name="Opening" minutes={10} canCurate={false} onSave={vi.fn()}/>); expect(screen.getByText('Target: 10 min')).toBeInTheDocument(); expect(screen.queryByRole('button')).not.toBeInTheDocument(); });
});
