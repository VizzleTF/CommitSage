import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

// Per-branch commit refs live in workspaceState (a per-workspace Memento):
// personal, never committed, and free of file churn. Branch refs are inherently
// local/ephemeral, so this is a better fit than a tracked file. Stored as a
// single map under one key so the whole set is read/written atomically.
const BRANCH_REFS_KEY = 'commitSage.branchRefs';

type BranchRefs = Record<string, string>;

export class RefStore {
    private static memento: vscode.Memento | undefined;

    static init(context: vscode.ExtensionContext): void {
        this.memento = context.workspaceState;
    }

    private static read(): BranchRefs {
        return this.memento?.get<BranchRefs>(BRANCH_REFS_KEY) ?? {};
    }

    /** Saved ref for `branch`, or undefined when none is stored. */
    static getBranchRef(branch: string): string | undefined {
        if (!branch) {
            return undefined;
        }
        const ref = this.read()[branch];
        return ref || undefined;
    }

    static async setBranchRef(branch: string, ref: string): Promise<void> {
        if (!this.memento || !branch) {
            return;
        }
        const map = { ...this.read() };
        const trimmed = ref.trim();
        if (trimmed) {
            map[branch] = trimmed;
        } else {
            delete map[branch];
        }
        await this.memento.update(BRANCH_REFS_KEY, map);
        Logger.log(`Branch ref for "${branch}" ${trimmed ? 'saved' : 'cleared'}`);
    }

    static async clearBranchRef(branch: string): Promise<void> {
        await this.setBranchRef(branch, '');
    }
}
