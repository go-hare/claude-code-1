/**
 * Singleton manager for cloud-provider authentication status (AWS Bedrock,
 * GCP Vertex). Communicates auth refresh state between auth utilities and
 * React components / SDK output. The SDK 'auth_status' message shape is
 * provider-agnostic, so a single manager serves all providers.
 *
 * Legacy name: originally AWS-only; now used by all cloud auth refresh flows.
 */

import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'
import { createSignal } from './signal.js'

export type AwsAuthStatus = {
  isAuthenticating: boolean
  output: string[]
  error?: string
}

const awsAuthStatusManagerByHost = new HostSlot<{
  instance: AwsAuthStatusManager | null
}>(() => ({ instance: null }))

export class AwsAuthStatusManager {
  private status: AwsAuthStatus = {
    isAuthenticating: false,
    output: [],
  }
  private changed = createSignal<[status: AwsAuthStatus]>()

  static getInstance(): AwsAuthStatusManager {
    const slot = awsAuthStatusManagerByHost.of(getBootstrapSessionHost())
    if (!slot.instance) {
      slot.instance = new AwsAuthStatusManager()
    }
    return slot.instance
  }

  getStatus(): AwsAuthStatus {
    return {
      ...this.status,
      output: [...this.status.output],
    }
  }

  startAuthentication(): void {
    this.status = {
      isAuthenticating: true,
      output: [],
    }
    this.changed.emit(this.getStatus())
  }

  addOutput(line: string): void {
    this.status.output.push(line)
    this.changed.emit(this.getStatus())
  }

  setError(error: string): void {
    this.status.error = error
    this.changed.emit(this.getStatus())
  }

  endAuthentication(success: boolean): void {
    if (success) {
      // Clear the status completely on success
      this.status = {
        isAuthenticating: false,
        output: [],
      }
    } else {
      // Keep the output visible on failure
      this.status.isAuthenticating = false
    }
    this.changed.emit(this.getStatus())
  }

  subscribe = this.changed.subscribe

  // Clean up for testing
  static reset(): void {
    const slot = awsAuthStatusManagerByHost.peek(getBootstrapSessionHost())
    if (slot?.instance) {
      slot.instance.changed.clear()
      slot.instance = null
    }
  }
}
