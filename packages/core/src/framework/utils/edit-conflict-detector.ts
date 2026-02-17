/**
 * Edit Collision Detection and Resolution
 * 
 * Prevents overlapping edits that can cause file corruption during transform.
 * Handles hierarchical editing where parent expressions should be processed
 * before child expressions.
 */

/**
 * Represents a text range in a source file
 */
export interface TextRange {
  /** Start position (0-based) */
  start: number;
  /** End position (0-based, exclusive) */
  end: number;
}

/**
 * Represents a planned edit operation
 */
export interface EditOperation {
  /** Unique identifier for this edit */
  id: string;
  /** The range to be replaced */
  range: TextRange;
  /** The replacement text */
  replacement: string;
  /** Optional parent edit ID (for nested expressions) */
  parentId?: string;
  /** Priority for ordering (higher = process first) */
  priority?: number;
  /** Metadata about what's being edited */
  metadata?: {
    /** Type of expression being edited */
    expressionType?: string;
    /** Original text being replaced */
    originalText?: string;
    /** The generated translation key */
    translationKey?: string;
  };
}

/**
 * Result of conflict detection
 */
export interface ConflictResult {
  /** Whether there are conflicts */
  hasConflicts: boolean;
  /** List of conflicting edit pairs */
  conflicts: Array<{
    edit1: EditOperation;
    edit2: EditOperation;
    type: ConflictType;
  }>;
  /** Suggested resolution */
  resolution?: EditOperation[];
}

/**
 * Types of edit conflicts
 */
export enum ConflictType {
  /** One edit completely contains another */
  Containment = 'containment',
  /** Edits partially overlap */
  Overlap = 'overlap',
  /** Adjacent edits that might merge incorrectly */
  Adjacent = 'adjacent',
  /** Duplicate edits targeting the same range */
  Duplicate = 'duplicate',
}

/**
 * Result of edit plan validation
 */
export interface ValidationResult {
  /** Whether the edit plan is valid */
  isValid: boolean;
  /** Issues found during validation */
  issues: ValidationIssue[];
}

/**
 * A validation issue
 */
export interface ValidationIssue {
  /** Severity of the issue */
  severity: 'error' | 'warning';
  /** Description of the issue */
  message: string;
  /** Related edit IDs */
  editIds: string[];
}

/**
 * Configuration for the conflict detector
 */
export interface EditConflictConfig {
  /** Whether to allow adjacent edits */
  allowAdjacent?: boolean;
  /** Minimum gap between non-conflicting edits */
  minGap?: number;
  /** Whether to automatically resolve containment conflicts */
  autoResolveContainment?: boolean;
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Check if two ranges overlap
 */
export function rangesOverlap(r1: TextRange, r2: TextRange): boolean {
  return r1.start < r2.end && r2.start < r1.end;
}

/**
 * Check if range1 contains range2
 */
export function rangeContains(outer: TextRange, inner: TextRange): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}

/**
 * Check if two ranges are adjacent (touching but not overlapping)
 */
export function rangesAdjacent(r1: TextRange, r2: TextRange): boolean {
  return r1.end === r2.start || r2.end === r1.start;
}

/**
 * Check if two ranges are identical
 */
export function rangesEqual(r1: TextRange, r2: TextRange): boolean {
  return r1.start === r2.start && r1.end === r2.end;
}

/**
 * Detect conflicts between edits
 */
export function detectConflicts(
  edits: EditOperation[],
  config: EditConflictConfig = {}
): ConflictResult {
  const conflicts: ConflictResult['conflicts'] = [];
  const { allowAdjacent = true, minGap = 0 } = config;

  // Compare all pairs
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      const e1 = edits[i];
      const e2 = edits[j];

      // Check for duplicate ranges
      if (rangesEqual(e1.range, e2.range)) {
        conflicts.push({ edit1: e1, edit2: e2, type: ConflictType.Duplicate });
        continue;
      }

      // Check for containment (one edit inside another)
      if (rangeContains(e1.range, e2.range)) {
        conflicts.push({ edit1: e1, edit2: e2, type: ConflictType.Containment });
        continue;
      }
      if (rangeContains(e2.range, e1.range)) {
        conflicts.push({ edit1: e2, edit2: e1, type: ConflictType.Containment });
        continue;
      }

      // Check for overlap
      if (rangesOverlap(e1.range, e2.range)) {
        conflicts.push({ edit1: e1, edit2: e2, type: ConflictType.Overlap });
        continue;
      }

      // Check for adjacent conflicts if not allowed
      if (!allowAdjacent && rangesAdjacent(e1.range, e2.range)) {
        conflicts.push({ edit1: e1, edit2: e2, type: ConflictType.Adjacent });
        continue;
      }

      // Check minimum gap
      if (minGap > 0) {
        const gap = Math.max(e1.range.start, e2.range.start) - 
                    Math.min(e1.range.end, e2.range.end);
        if (gap >= 0 && gap < minGap) {
          conflicts.push({ edit1: e1, edit2: e2, type: ConflictType.Adjacent });
        }
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Plan edits to avoid conflicts by ordering correctly
 * 
 * Strategy:
 * 1. Process parent expressions before children (for containment)
 * 2. Process from end of file to start (to maintain position validity)
 * 3. Filter out nested edits when parent is being edited
 */
export function planEdits(
  edits: EditOperation[],
  config: EditConflictConfig = {}
): EditOperation[] {
  const { autoResolveContainment = true } = config;

  if (edits.length === 0) return [];

  // Build parent-child relationships
  const childToParent = new Map<string, string>();
  const parentToChildren = new Map<string, Set<string>>();

  // Detect containment relationships
  for (let i = 0; i < edits.length; i++) {
    for (let j = 0; j < edits.length; j++) {
      if (i === j) continue;
      const outer = edits[i];
      const inner = edits[j];

      if (rangeContains(outer.range, inner.range) && !rangesEqual(outer.range, inner.range)) {
        // outer contains inner - inner is a child of outer
        childToParent.set(inner.id, outer.id);
        
        if (!parentToChildren.has(outer.id)) {
          parentToChildren.set(outer.id, new Set());
        }
        parentToChildren.get(outer.id)!.add(inner.id);
      }
    }
  }

  // If auto-resolving containment, exclude children when parent exists
  let filteredEdits = edits;
  if (autoResolveContainment) {
    filteredEdits = edits.filter(edit => {
      const parentId = childToParent.get(edit.id);
      if (!parentId) return true;
      
      // Check if parent edit exists in the list
      const parentExists = edits.some(e => e.id === parentId);
      return !parentExists;
    });
  }

  // Sort by position (end of file first) and then by priority
  return [...filteredEdits].sort((a, b) => {
    // Higher priority first
    if ((a.priority ?? 0) !== (b.priority ?? 0)) {
      return (b.priority ?? 0) - (a.priority ?? 0);
    }
    // Later positions first (for reverse iteration)
    return b.range.start - a.range.start;
  });
}

/**
 * Apply edits to source text
 * 
 * Applies edits in the planned order to avoid position shifts
 */
export function applyEdits(source: string, edits: EditOperation[]): string {
  // Sort by position (end first)
  const sortedEdits = [...edits].sort((a, b) => b.range.start - a.range.start);
  
  let result = source;
  for (const edit of sortedEdits) {
    if (edit.range.start < 0 || edit.range.end > result.length) {
      throw new Error(`Invalid edit range [${edit.range.start}, ${edit.range.end}] for source of length ${result.length}`);
    }
    if (edit.range.start > edit.range.end) {
      throw new Error(`Invalid edit range: start (${edit.range.start}) > end (${edit.range.end})`);
    }
    
    result = result.slice(0, edit.range.start) + 
             edit.replacement + 
             result.slice(edit.range.end);
  }
  
  return result;
}

/**
 * Validate an edit plan before execution
 */
export function validateEditPlan(
  edits: EditOperation[],
  sourceLength: number
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Check for invalid ranges
  for (const edit of edits) {
    if (edit.range.start < 0) {
      issues.push({
        severity: 'error',
        message: `Edit ${edit.id} has negative start position: ${edit.range.start}`,
        editIds: [edit.id],
      });
    }
    if (edit.range.end > sourceLength) {
      issues.push({
        severity: 'error',
        message: `Edit ${edit.id} end position (${edit.range.end}) exceeds source length (${sourceLength})`,
        editIds: [edit.id],
      });
    }
    if (edit.range.start > edit.range.end) {
      issues.push({
        severity: 'error',
        message: `Edit ${edit.id} has invalid range: start (${edit.range.start}) > end (${edit.range.end})`,
        editIds: [edit.id],
      });
    }
  }

  // Check for conflicts
  const conflictResult = detectConflicts(edits);
  for (const conflict of conflictResult.conflicts) {
    const severity = conflict.type === ConflictType.Adjacent ? 'warning' : 'error';
    issues.push({
      severity,
      message: `${conflict.type} conflict between edits ${conflict.edit1.id} and ${conflict.edit2.id}`,
      editIds: [conflict.edit1.id, conflict.edit2.id],
    });
  }

  return {
    isValid: issues.every(i => i.severity !== 'error'),
    issues,
  };
}

// =============================================================================
// EditConflictDetector Class
// =============================================================================

/**
 * Main class for managing edit conflicts and planning transformations
 */
export class EditConflictDetector {
  private config: EditConflictConfig;
  private pendingEdits: EditOperation[] = [];
  private completedEdits: EditOperation[] = [];

  constructor(config: EditConflictConfig = {}) {
    this.config = {
      allowAdjacent: true,
      minGap: 0,
      autoResolveContainment: true,
      ...config,
    };
  }

  /**
   * Add an edit to the pending queue
   */
  addEdit(edit: EditOperation): void {
    this.pendingEdits.push(edit);
  }

  /**
   * Add multiple edits
   */
  addEdits(edits: EditOperation[]): void {
    this.pendingEdits.push(...edits);
  }

  /**
   * Clear all pending edits
   */
  clear(): void {
    this.pendingEdits = [];
    this.completedEdits = [];
  }

  /**
   * Get current pending edits
   */
  getPendingEdits(): EditOperation[] {
    return [...this.pendingEdits];
  }

  /**
   * Detect conflicts in pending edits
   */
  detectConflicts(): ConflictResult {
    return detectConflicts(this.pendingEdits, this.config);
  }

  /**
   * Plan edits for safe execution
   */
  plan(): EditOperation[] {
    return planEdits(this.pendingEdits, this.config);
  }

  /**
   * Validate pending edits against a source
   */
  validate(sourceLength: number): ValidationResult {
    return validateEditPlan(this.pendingEdits, sourceLength);
  }

  /**
   * Apply planned edits to source
   */
  apply(source: string): { result: string; appliedEdits: EditOperation[] } {
    const planned = this.plan();
    const validation = validateEditPlan(planned, source.length);
    
    if (!validation.isValid) {
      const errors = validation.issues.filter(i => i.severity === 'error');
      throw new Error(`Invalid edit plan: ${errors.map(e => e.message).join('; ')}`);
    }

    const result = applyEdits(source, planned);
    this.completedEdits = planned;
    this.pendingEdits = [];
    
    return { result, appliedEdits: planned };
  }

  /**
   * Get completed edits from last application
   */
  getCompletedEdits(): EditOperation[] {
    return [...this.completedEdits];
  }

  /**
   * Create a rollback plan (inverse of applied edits)
   * 
   * Note: This only works if you have the original source
   */
  createRollbackPlan(originalSource: string): EditOperation[] {
    // Rebuild positions based on original source
    const rollback: EditOperation[] = [];
    let offset = 0;

    // Process in original order (not reversed)
    const sortedCompleted = [...this.completedEdits].sort(
      (a, b) => a.range.start - b.range.start
    );

    for (const edit of sortedCompleted) {
      const originalText = originalSource.slice(edit.range.start, edit.range.end);
      const newStart = edit.range.start + offset;
      const newEnd = newStart + edit.replacement.length;

      rollback.push({
        id: `rollback-${edit.id}`,
        range: { start: newStart, end: newEnd },
        replacement: originalText,
        metadata: {
          originalText: edit.replacement,
        },
      });

      // Update offset based on length difference
      offset += edit.replacement.length - (edit.range.end - edit.range.start);
    }

    return rollback;
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Quick function to check if edits can be safely applied
 */
export function canApplyEdits(edits: EditOperation[], sourceLength: number): boolean {
  const validation = validateEditPlan(edits, sourceLength);
  return validation.isValid;
}

/**
 * Helper to create an edit operation
 */
export function createEdit(
  id: string,
  start: number,
  end: number,
  replacement: string,
  options?: Partial<EditOperation>
): EditOperation {
  return {
    id,
    range: { start, end },
    replacement,
    ...options,
  };
}
