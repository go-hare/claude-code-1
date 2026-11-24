export interface Environment {
  id: string
  machine_name?: string
  directory?: string
  status: string
  branch?: string
  worker_type?: string
  channel_group_id?: string | null
  capabilities?: Record<string, unknown> | null
}

export interface Session {
  id: string
  title?: string
  status: string
  environment_id?: string
  source?: string
  created_at?: number
  updated_at?: number
  automation_state?: unknown
}

export interface SessionEvent {
  type: string
  payload?: EventPayload
  direction?: 'inbound' | 'outbound'
  seqNum?: number
  id?: string
}

export interface SessionTaskItem {
  id: string
  subject: string
  status: string
  description?: string
  owner?: string
}

export interface AutomationState {
  enabled: boolean
  phase: 'standby' | 'sleeping' | null
  next_tick_at: number | null
  sleep_until: number | null
}

export interface EventPayload {
  content?: string
  message?: unknown
  status?: string
  uuid?: string
  isSynthetic?: boolean
  raw?: {
    uuid?: string
    status?: string
    isSynthetic?: boolean
    message?: unknown
    tasks?: unknown[]
    task_list_id?: string
  }
  request_id?: string
  request?: PermissionRequest
  response?: Record<string, unknown>
  approved?: boolean
  tool_name?: string
  tool_input?: unknown
  tool_call_id?: string
  tool_use_id?: string
  output?: unknown
  is_error?: boolean
  input?: unknown
  description?: string
  tasks?: unknown[]
  task_list_id?: string
  taskListId?: string
  enabled?: boolean
  phase?: 'standby' | 'sleeping' | null
  next_tick_at?: number | null
  sleep_until?: number | null
}

export interface ContentBlock {
  type: string
  id?: string
  tool_use_id?: string
  tool_call_id?: string
  text?: string
  name?: string
  input?: unknown
  content?: unknown
  is_error?: boolean
}

export interface PermissionRequest {
  subtype?: string
  tool_name?: string
  tool_use_id?: string
  tool_call_id?: string
  input?: unknown
  tool_input?: unknown
  description?: string
}

export interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options?: QuestionOption[]
  metadata?: Record<string, unknown>
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface ControlResponse {
  type: 'permission_response'
  approved: boolean
  request_id: string
  message?: string
  updated_input?: Record<string, unknown>
  updated_permissions?: PermissionUpdate[]
}

export interface PermissionUpdate {
  type: string
  mode: string
  destination: string
}

export type ActivityMode = 'working' | 'idle' | 'standby' | 'sleeping'

export interface AutomationActivity {
  mode: ActivityMode
  iconVariant: string
  label: string
  endsAt?: number
}
