import { DraftingModule } from './drafting/drafting.module';
import { LitigationModule } from './litigation/litigation.module';

/** Unit modules (one per Legal unit). */
export const UNIT_MODULES: any[] = [LitigationModule, DraftingModule];
