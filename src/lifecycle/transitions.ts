import type { ProjectState } from "../domain";

export type ProjectStateTransition = {
  from: ProjectState;
  to: ProjectState;
  allowed: boolean;
  forced: boolean;
};

export class InvalidProjectStateTransitionError extends Error {
  transition: ProjectStateTransition;

  constructor(transition: ProjectStateTransition) {
    super(
      `Unsupported lifecycle transition ${transition.from} -> ${transition.to}. Re-run with force if this override is intentional.`,
    );
    this.name = "InvalidProjectStateTransitionError";
    this.transition = transition;
  }
}

const allowedTransitions: Record<ProjectState, ProjectState[]> = {
  experiment: ["candidate", "commercial", "open-source", "archived"],
  candidate: ["experiment", "commercial", "archived"],
  commercial: ["archived"],
  "open-source": ["archived"],
  archived: ["experiment", "open-source"],
};

export function planProjectStateTransition(
  from: ProjectState,
  to: ProjectState,
  options: { force?: boolean } = {},
): ProjectStateTransition {
  const allowed = from === to || allowedTransitions[from].includes(to);
  const transition = {
    from,
    to,
    allowed,
    forced: !allowed && options.force === true,
  };
  if (!allowed && !options.force) {
    throw new InvalidProjectStateTransitionError(transition);
  }
  return transition;
}
