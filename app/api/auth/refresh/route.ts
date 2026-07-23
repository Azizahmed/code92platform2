import {createRefreshAuthRouter} from '@insforge/sdk/ssr';

// Standard app refresh endpoint used by the browser client.
export const {POST} = createRefreshAuthRouter();
