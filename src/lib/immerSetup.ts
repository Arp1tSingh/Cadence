import { setAutoFreeze } from 'immer';

/*
 * Immer deep-freezes every produced state by default. A parsed book holds
 * thousands of chapters/sentences/words, so each library or player update
 * would walk and freeze that whole tree again. Production state is never
 * mutated by hand, so freezing buys nothing here and costs a lot on open.
 *
 * This module is imported first in `main.tsx`, before any store module runs,
 * so no state update can be produced with freezing still enabled.
 */
setAutoFreeze(false);
