/**
 * MapStateMachine - Explicit state management for map initialization
 *
 * Replaces fragile boolean flags with validated state transitions
 * to prevent race conditions and invalid states.
 *
 * States:
 * - UNINITIALIZED: Map not created yet
 * - SCHEDULED: Init scheduled but not started
 * - INITIALIZING: Init in progress
 * - READY: Map initialized and ready
 * - ERROR: Init failed
 */

const MapStates = {
    UNINITIALIZED: 'uninitialized',
    SCHEDULED: 'scheduled',
    INITIALIZING: 'initializing',
    READY: 'ready',
    ERROR: 'error'
};

class MapStateMachine {
    constructor() {
        this.state = MapStates.UNINITIALIZED;
        this.generation = 0;  // Track DOM version for stale callback detection
        this.errorMessage = null;
    }

    /**
     * Valid state transitions
     */
    static VALID_TRANSITIONS = {
        [MapStates.UNINITIALIZED]: [MapStates.SCHEDULED],
        [MapStates.SCHEDULED]: [MapStates.INITIALIZING, MapStates.UNINITIALIZED],
        [MapStates.INITIALIZING]: [MapStates.READY, MapStates.ERROR, MapStates.UNINITIALIZED],
        [MapStates.READY]: [MapStates.UNINITIALIZED],
        [MapStates.ERROR]: [MapStates.SCHEDULED, MapStates.UNINITIALIZED]
    };

    /**
     * Attempt to transition to a new state
     * @returns {boolean} True if transition is valid, false otherwise
     */
    transition(newState) {
        const validTransitions = MapStateMachine.VALID_TRANSITIONS[this.state] || [];

        if (!validTransitions.includes(newState)) {
            console.warn(`[MapStateMachine] Invalid transition from ${this.state} to ${newState}`);
            return false;
        }

        const oldState = this.state;
        this.state = newState;

        // Clear error message on successful transition away from error
        if (oldState === MapStates.ERROR && newState !== MapStates.ERROR) {
            this.errorMessage = null;
        }

        return true;
    }

    /**
     * Schedule map initialization
     * @returns {number|null} Generation number if scheduled, null if invalid
     */
    scheduleInit() {
        // Only schedule from UNINITIALIZED or ERROR states
        if (this.state === MapStates.UNINITIALIZED || this.state === MapStates.ERROR) {
            if (this.transition(MapStates.SCHEDULED)) {
                this.generation++;
                return this.generation;
            }
        }

        // Already scheduled or initializing
        return null;
    }

    /**
     * Begin initialization
     * @param {number} expectedGeneration - Expected generation number
     * @returns {boolean} True if can initialize, false if stale or invalid
     */
    beginInit(expectedGeneration) {
        // Validate generation (prevent stale callbacks)
        if (expectedGeneration !== undefined && expectedGeneration !== this.generation) {
            console.log(`[MapStateMachine] Stale init (expected ${expectedGeneration}, current ${this.generation})`);
            return false;
        }

        // Must be in SCHEDULED state
        if (this.state !== MapStates.SCHEDULED) {
            return false;
        }

        return this.transition(MapStates.INITIALIZING);
    }

    /**
     * Mark initialization as complete
     */
    markReady() {
        return this.transition(MapStates.READY);
    }

    /**
     * Mark initialization as failed
     * @param {string} errorMessage - Error description
     */
    markError(errorMessage) {
        this.errorMessage = errorMessage;
        return this.transition(MapStates.ERROR);
    }

    /**
     * Reset to uninitialized (e.g., on suspend)
     */
    reset() {
        this.state = MapStates.UNINITIALIZED;
        this.errorMessage = null;
        // Don't reset generation - it should keep incrementing
    }

    /**
     * Cancel scheduled/in-progress initialization
     */
    cancel() {
        if (this.state === MapStates.SCHEDULED || this.state === MapStates.INITIALIZING) {
            return this.transition(MapStates.UNINITIALIZED);
        }
        return false;
    }

    // State checks
    isUninitialized() { return this.state === MapStates.UNINITIALIZED; }
    isScheduled() { return this.state === MapStates.SCHEDULED; }
    isInitializing() { return this.state === MapStates.INITIALIZING; }
    isReady() { return this.state === MapStates.READY; }
    isError() { return this.state === MapStates.ERROR; }

    /**
     * Check if initialization is in progress (scheduled or initializing)
     */
    isInProgress() {
        return this.state === MapStates.SCHEDULED || this.state === MapStates.INITIALIZING;
    }

    /**
     * Get current state info for debugging
     */
    getStateInfo() {
        return {
            state: this.state,
            generation: this.generation,
            errorMessage: this.errorMessage,
            isReady: this.isReady(),
            isInProgress: this.isInProgress()
        };
    }
}

// Export for browser (frontend)
if (typeof window !== 'undefined') {
    window.MapStateMachine = MapStateMachine;
    window.MapStates = MapStates;
}

// Export for Node.js (if ever needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MapStateMachine, MapStates };
}
