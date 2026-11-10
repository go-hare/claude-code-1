import * as React from 'react';
import type { SystemAPIErrorMessage as SystemAPIErrorMessageType } from 'src/types/message.js';

type Props = {
  message: SystemAPIErrorMessageType;
  verbose: boolean;
};

/** densable 2.1.289: api_error in transcript returns null (live retry renders in Spinner). */
export function SystemAPIErrorMessage(_props: Props): React.ReactNode {
  return null;
}
