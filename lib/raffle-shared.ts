export const DEFAULT_RAFFLE_COMMAND = '!enter';
export const MIN_DURATION_SECONDS = 15;
export const MAX_DURATION_SECONDS = 60 * 60; // 1 hour — long enough for any real giveaway, short enough that an operator who walks away doesn't leave one open all night.
export const MAX_WINNER_COUNT = 50;

export type RaffleStatus = 'open' | 'closed';

