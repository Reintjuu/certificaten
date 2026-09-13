// The list of ways to train, which is the one place that knows all seven of
// them. The console asks it for names to put in the dropdown and for a trainer
// to run; it does not know what any of them do.
import { createTrainer } from "./evolution";
import { createReinforceTrainer } from "./reinforce";
import { createCloneTrainerUsing } from "./clone";
import { createCmaesTrainer } from "./cmaes";
import { createMapElitesTrainer } from "./map-elites";
import { DQN_ARCHITECTURE, createDqnTrainer } from "./dqn";
import { NEAT_ARCHITECTURE, createNeatTrainer } from "./neat-trainer";
import { DEFAULT_ARCHITECTURE, type Architecture, type Genome } from "./policy";
import type { Trainer, TrainerOptions } from "./evolution";

export type Method = "evolution" | "gradient" | "clone" | "archive" | "cmaes" | "qlearning" | "neat";

export type TrainingMethod = {
  /** Names the method in the dropdown. */
  label: string;
  /**
   * The training screen's header, where the full name ran over the progress
   * bar.
   */
  short: string;
  create: (levelIndex: number, options?: TrainerOptions) => Trainer;
  /**
   * Lets a method choose its own output layer: a value head has one output per
   * button combination where a control head has three.
   */
  architectureFor: (hidden: readonly number[]) => Architecture;
};

const controlHead = (hidden: readonly number[]): Architecture => ({ ...DEFAULT_ARCHITECTURE, hidden });
const valueHead = (hidden: readonly number[]): Architecture => ({ ...DQN_ARCHITECTURE, hidden });

/**
 * Built rather than declared, because cloning needs to be told where to find a
 * teacher and that answer changes every time the console retrains.
 */
export function trainingMethods(teacherFor: (level: number) => Genome): Record<Method, TrainingMethod> {
  return {
    evolution: {
      label: "evolutie",
      short: "EVOLUTIE",
      create: createTrainer,
      architectureFor: controlHead,
    },
    gradient: {
      label: "gradient (REINFORCE)",
      short: "GRADIENT",
      create: createReinforceTrainer,
      architectureFor: controlHead,
    },
    clone: {
      label: "nadoen (behaviour cloning)",
      short: "NADOEN",
      create: createCloneTrainerUsing(teacherFor),
      architectureFor: controlHead,
    },
    archive: {
      label: "MAP-Elites (archief)",
      short: "MAP-ELITES",
      create: createMapElitesTrainer,
      architectureFor: controlHead,
    },
    cmaes: {
      label: "CMA-ES",
      short: "CMA-ES",
      create: createCmaesTrainer,
      architectureFor: controlHead,
    },
    qlearning: {
      label: "Q-learning (DQN)",
      short: "DQN",
      create: createDqnTrainer,
      architectureFor: valueHead,
    },
    neat: {
      label: "NEAT (vorm groeit mee)",
      short: "NEAT",
      create: createNeatTrainer,
      // NEAT decides its own hidden nodes, so the setting does not apply.
      architectureFor: (): Architecture => NEAT_ARCHITECTURE,
    },
  };
}

/** Whether a string off a dropdown is one of the methods. */
export function isMethod(value: string, methods: Record<Method, TrainingMethod>): value is Method {
  return value in methods;
}
