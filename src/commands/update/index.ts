/**

 * densable 2.1.248 slash `/update` (alias `/restart`) — official R4n / Mhr.

 *

 * Tip SEA registration @186766158:

 *   isEnabled:()=>!1, isHidden:!0

 *   fleetHostCall:async({relaunch:e})=>e()

 * Body Mhr @192084756 still lands refuse arms incl. wU(...,GC()).

 *

 * Leftover keeps the tip gate closed; body is callable for fleetHostCall /

 * tests. Foreground Ket/`_G`: leftover acceptTuiRelaunch with o5/i5

 * extraArgs (Cmt+Rmt), env `$B()`+team+s5, injectTuiSwitch:false. Not Yk.

 */

import type { Command } from '../../commands.js'

const update = {
  type: 'local',

  name: 'update',

  aliases: ['restart'],

  description: 'Switch to the latest version (conversation continues)',

  supportsNonInteractive: false,

  // official tip SEA: isEnabled:()=>!1, isHidden:!0

  isEnabled: () => false,

  isHidden: true,

  // official tip SEA: fleetHostCall:async({relaunch:e})=>e()

  fleetHostCall: async ({ relaunch }) => {
    await relaunch()
  },

  load: () => import('./update.js'),
} satisfies Command

export default update
