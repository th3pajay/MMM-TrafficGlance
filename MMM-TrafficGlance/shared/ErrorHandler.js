/**
 * ErrorHandler - Centralized error tracking and retry management
 *
 * Provides:
 * - Error categorization (quota, network, validation, database, unknown)
 * - Exponential backoff for retries
 * - User-friendly error messages
 * - Error history tracking
 */

class ErrorHandler {
    constructor() {
        this.errors = new Map(); // context -> {lastError, count, lastTime}
        this.retryAttempts = new Map(); // context -> attempt count
        this.MAX_RETRY_ATTEMPTS = 5;
        this.BASE_BACKOFF_MS = 1000;
        this.MAX_BACKOFF_MS = 60000;
    }

    /**
     * Categorize error type for better handling
     */
    categorizeError(error) {
        if (!error) return 'unknown';

        // Quota errors — check body before treating 403 as quota; a bad API key also returns 403
        if (error.response?.status === 429) return 'rate_limit';
        if (error.response?.status === 403) {
            const body = JSON.stringify(error.response.data || '').toLowerCase();
            return (body.includes('quota') || body.includes('too many')) ? 'quota' : 'auth_failure';
        }

        const errorText = JSON.stringify(error.response?.data || error.message || '').toLowerCase();
        if (errorText.includes('quota') || errorText.includes('rate limit')) return 'quota';

        // Network errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            return 'network';
        }
        if (error.response?.status >= 500) return 'server_error';

        // Validation errors
        if (error.response?.status === 400) return 'validation';

        // Database errors
        if (error.code === 'SQLITE_ERROR' || error.message?.includes('database')) {
            return 'database';
        }

        return 'unknown';
    }

    /**
     * Get user-friendly error message
     */
    getUserMessage(error, category) {
        const messages = {
            quota: 'API quota exceeded. Switching to traffic tiles only.',
            auth_failure: 'API key rejected (403). Check apiKey in config.',
            rate_limit: 'Rate limit reached. Retrying with backoff...',
            network: 'Network connection failed. Check your internet connection.',
            server_error: 'TomTom API server error. Retrying...',
            validation: 'Invalid route configuration. Check your config.',
            database: 'Database error. Check SQLite configuration.',
            unknown: 'Unexpected error occurred. Check logs for details.'
        };

        return messages[category] || messages.unknown;
    }

    /**
     * Calculate exponential backoff delay
     */
    getExponentialBackoff(attempts) {
        const delay = Math.min(
            this.BASE_BACKOFF_MS * Math.pow(2, attempts),
            this.MAX_BACKOFF_MS
        );
        // Add jitter (±20%) to prevent thundering herd
        const jitter = delay * 0.2 * (Math.random() - 0.5);
        return Math.floor(delay + jitter);
    }

    /**
     * Check if should retry based on error category and attempt count
     */
    shouldRetry(context, category) {
        const attempts = this.retryAttempts.get(context) || 0;

        // Never retry quota or auth errors
        if (category === 'quota' || category === 'auth_failure') return false;

        // Retry network, server, and rate limit errors
        if (['network', 'server_error', 'rate_limit'].includes(category)) {
            return attempts < this.MAX_RETRY_ATTEMPTS;
        }

        // Don't retry validation or database errors
        return false;
    }

    /**
     * Handle error and decide on action
     */
    handleError(context, error) {
        const category = this.categorizeError(error);
        const userMessage = this.getUserMessage(error, category);
        const attempts = this.retryAttempts.get(context) || 0;

        // Track error
        this.errors.set(context, {
            lastError: error,
            category: category,
            count: (this.errors.get(context)?.count || 0) + 1,
            lastTime: Date.now(),
            userMessage: userMessage
        });

        // Log error details
        console.error(`[TrafficGlance] Error in ${context} (${category}):`, error.message || error);

        // Determine action
        const shouldRetry = this.shouldRetry(context, category);
        if (shouldRetry) {
            const newAttempts = attempts + 1;
            this.retryAttempts.set(context, newAttempts);
            const backoffMs = this.getExponentialBackoff(newAttempts);
            console.log(`[TrafficGlance] Retry ${newAttempts}/${this.MAX_RETRY_ATTEMPTS} in ${backoffMs}ms`);

            return {
                action: 'retry',
                backoffMs: backoffMs,
                userMessage: userMessage,
                category: category
            };
        }

        return {
            action: category === 'quota' ? 'quota_exhausted' : 'fail',
            userMessage,
            category
        };
    }

    /**
     * Reset retry attempts for a context (call on success)
     */
    resetRetries(context) {
        this.retryAttempts.delete(context);
    }

    /**
     * Get error statistics
     */
    getStats() {
        const stats = {};
        for (const [context, error] of this.errors.entries()) {
            stats[context] = {
                category: error.category,
                count: error.count,
                lastTime: new Date(error.lastTime).toISOString()
            };
        }
        return stats;
    }

    /**
     * Clear error history
     */
    clear() {
        this.errors.clear();
        this.retryAttempts.clear();
    }
}

module.exports = ErrorHandler;
