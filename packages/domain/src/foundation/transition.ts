import { cloneAndFreeze, type DeepReadonly } from "./immutable.js";
import { failure, success, type Failure, type Result, type Success } from "./result.js";

export type Transition<Aggregate, EventDraft, TransitionRecord = never> = Readonly<{
  events: readonly DeepReadonly<EventDraft>[];
  nextAggregate: DeepReadonly<Aggregate>;
  transitionRecords: readonly DeepReadonly<TransitionRecord>[];
}>;

export type TransitionResult<Aggregate, EventDraft, Error, TransitionRecord = never> = Result<
  Transition<Aggregate, EventDraft, TransitionRecord>,
  DeepReadonly<Error>
>;

export const transitionSuccess = <Aggregate, EventDraft, TransitionRecord = never>(
  nextAggregate: Aggregate,
  events: readonly EventDraft[],
  transitionRecords: readonly TransitionRecord[] = [],
): Success<Transition<Aggregate, EventDraft, TransitionRecord>> =>
  success(
    Object.freeze({
      events: cloneAndFreeze(events),
      nextAggregate: cloneAndFreeze(nextAggregate),
      transitionRecords: cloneAndFreeze(transitionRecords),
    }),
  );

export const transitionFailure = <Error>(error: Error): Failure<DeepReadonly<Error>> =>
  failure(cloneAndFreeze(error));
