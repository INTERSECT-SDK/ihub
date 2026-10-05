/* eslint-disable */
/**
 * This file is generated. Do not edit it directly.
 * Run `pnpm -C packages/utils generate:campaign-contract` instead.
 */

export type Description = string
export type Id = string
/**
 * @minItems 1
 */
export type Values = [Value, ...Value[]]
export type Id1 = string
export type Var = string
export type Inputs = Input[]
export type Name = string
export type Id2 = string
export type MaxTime = string
export type TaskGroup = string
export type MaxRuntime = MaxRuntime1[]
export type Id3 = string
export type Target = number
export type TaskGroup1 = string
export type Type = 'upper_limit'
export type Var1 = string
export type Id4 = string
export type Target1 = number
export type TaskGroup2 = string
export type Type1 = 'range'
export type Var2 = string
export type Threshold = (ThresholdUpperLimit | ThresholdRange)[]
/**
 * @minItems 1
 */
export type Values1 = [Value, ...Value[]]
export type Outputs = Output[]
export type RunId = string
export type GroupDependencies = string[]
export type Id5 = string
export type Id6 = string
export type Target2 = boolean
export type Type2 = string
export type Var3 = string
export type Id7 = string
export type Iterations = number
export type Type3 = string
export type Objectives = (ObjectiveAssert | ObjectiveIterate)[]
export type Capability = string
export type EventCount = number | null
export type EventMode = 'once' | 'count' | 'persistent'
export type EventName = string | null
export type Hierarchy = string
export type Id8 = string
export type OperationId = string | null
export type TaskDependencies = string[]
export type Tasks = Task[]
export type TaskGroups = TaskGroup3[]
export type User = string

/**
 * Main INTERSECT campaign model.
 *
 * Attributes:
 *     id: The ID of the campaign.
 *     run_id: The execution job id for the orchestrator to use.
 *     name: The name of the campaign.
 *     user: The user of the campaign.
 *     description: The description of the campaign.
 *     task_groups: A group of tasks.
 *     objectives: Objectives for the campaign.
 *     inputs: Inputs for the campaign.
 *     outputs: Outputs for the campaign.
 */
export interface Campaign {
  description: Description
  id: Id
  inputs?: Inputs
  name: Name
  objectives?: Objective | null
  outputs?: Outputs
  run_id?: RunId
  task_groups?: TaskGroups
  user: User
  [k: string]: unknown
}
/**
 * Input for a task.
 *
 * Attributes:
 *     json_schema: The schema for the input.
 *     values: The values for the input.
 */
export interface Input {
  schema: Schema
  values: Values
  [k: string]: unknown
}
export interface Schema {
  [k: string]: unknown
}
/**
 * Value for inputs and outputs.
 *
 * Attributes:
 *     id: The ID for the value.
 *     var: The associated variable.
 */
export interface Value {
  id: Id1
  var: Var
  [k: string]: unknown
}
/**
 * Objective for the campaign.
 *
 * Attributes:
 *     max_runtime: Max allowed runtime for a task group.
 *     threshold: Thresholds for a task group.
 */
export interface Objective {
  max_runtime?: MaxRuntime
  threshold?: Threshold
  [k: string]: unknown
}
/**
 * Maximum runtime for an objective.
 *
 * Attributes:
 *     id: The ID for the max runtime.
 *     max_time: Time duration as ISO 8601 format.
 *     task_group: The task group for this objective.
 */
export interface MaxRuntime1 {
  id: Id2
  max_time: MaxTime
  task_group: TaskGroup
  [k: string]: unknown
}
/**
 * Upper limit threshold for the objective.
 *
 * Attributes:
 *     id: The ID for the range.
 *     var: The variable associated with the objective.
 *     type: The type of threshold.
 *     target: The target value.
 *     task_group: The task group for this objective.
 */
export interface ThresholdUpperLimit {
  id: Id3
  target: Target
  task_group: TaskGroup1
  type: Type
  var: Var1
  [k: string]: unknown
}
/**
 * Range threshold for the objective.
 *
 * Attributes:
 *     id: The ID for the range.
 *     var: The variable associated with the objective.
 *     type: The type of threshold.
 *     target: The target value.
 *     task_group: The task group for this objective.
 */
export interface ThresholdRange {
  id: Id4
  target: Target1
  task_group: TaskGroup2
  type: Type1
  var: Var2
  [k: string]: unknown
}
/**
 * Output for a task.
 *
 * Attributes:
 *     json_schema: The schema for the output.
 *     values: The values for the output.
 */
export interface Output {
  schema: Schema1
  values: Values1
  [k: string]: unknown
}
export interface Schema1 {
  [k: string]: unknown
}
/**
 * Task group.
 *
 * Attributes:
 *     id: The ID for the task group.
 *     group_dependencies: Dependencies on other task groups.
 *     task: The tasks that make up the task group.
 *     objectives: The objectives for the task group.
 */
export interface TaskGroup3 {
  group_dependencies?: GroupDependencies
  id: Id5
  objectives?: Objectives
  tasks?: Tasks
  [k: string]: unknown
}
/**
 * Assertion for objectives.
 *
 * Attributes:
 *     id: The ID for the assertion objective.
 *     type: The type of assertion.
 *     var: The variable for the assertion.
 *     target: The target boolean.
 */
export interface ObjectiveAssert {
  id: Id6
  target: Target2
  type: Type2
  var: Var3
  [k: string]: unknown
}
/**
 * Iterations for an objective.
 *
 * Attributes:
 *     id: The ID for the iterations.
 *     type: The type of iteration.
 *     iterations: The number of iterations for the objective.
 */
export interface ObjectiveIterate {
  id: Id7
  iterations: Iterations
  type: Type3
  [k: string]: unknown
}
/**
 * An individual task in a task group.
 *
 * Attributes:
 *     id: The ID for the task.
 *     hierarchy: The hierarchy of the task.
 *     capability: The Capability of the task.
 *     operation_id: Operation of the task. Mutually exclusive with event_name.
 *     event_name: Name of the event to listen to. Mutually exclusive with operation_id.
 *     output: The optional output value for the task. If not defined, assume no output beyond generic INTERSECT metadata.
 *     input: The optional input value for the task. If not defined, assume no input.
 *     task_dependencies: Dependencies on other tasks.
 *     task_objectives: Objectives for the task.
 */
export interface Task {
  capability: Capability
  event_count?: EventCount
  event_mode?: EventMode
  event_name?: EventName
  hierarchy: Hierarchy
  id: Id8
  input?: Input | null
  operation_id?: OperationId
  output?: Output | null
  task_dependencies?: TaskDependencies
  task_objectives?: Objective | null
  [k: string]: unknown
}
