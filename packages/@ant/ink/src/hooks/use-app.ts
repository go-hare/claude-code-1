import { useContext } from 'react'
import AppContext from '../components/AppContext.js'

/**
 * densable Twe consumer — `useApp` exposes exit + focusManager + rootNode +
 * dispatchPasteEvent (AppContext / official Twe).
 */
const useApp = () => useContext(AppContext)
export default useApp
