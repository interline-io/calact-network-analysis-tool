/**
 * Generic task queue with configurable concurrency
 */
export class TaskQueue<T> {
  private tasks: T[] = []
  private concurrencyLimit: number
  private executor: (task: T) => Promise<void>
  private onProgress?: (completed: number, total: number) => void
  private onError?: (error: any, task: T) => void

  private isRunning = false
  private completed = 0
  private total = 0
  private activePromises: Promise<void>[] = []

  constructor (
    concurrencyLimit: number,
    executor: (task: T) => Promise<void>,
    options: {
      onProgress?: (completed: number, total: number) => void
      onError?: (error: any, task: T) => void
    } = {}
  ) {
    this.concurrencyLimit = concurrencyLimit
    this.executor = executor
    this.onProgress = options.onProgress
    this.onError = options.onError
  }

  /**
   * Add tasks to the queue
   */
  enqueue (tasks: T[]): void {
    this.tasks.push(...tasks)
    this.total += tasks.length
  }

  /**
   * Add a single task to the queue
   */
  enqueueOne (task: T): void {
    this.tasks.push(task)
    this.total += 1
  }

  /**
   * Start processing tasks and return a promise that resolves when all tasks complete
   */
  async run (): Promise<void> {
    if (this.isRunning) {
      throw new Error('Task queue is already running')
    }

    this.isRunning = true
    this.completed = 0

    try {
      await this.processQueue()
    } finally {
      this.isRunning = false
    }
  }

  /**
   * Wait for all currently queued tasks to complete
   */
  async wait (): Promise<void> {
    if (!this.isRunning) {
      return this.run()
    }

    // If already running, wait for completion
    return new Promise<void>((resolve) => {
      const checkComplete = () => {
        if (this.completed >= this.total && this.activePromises.length === 0) {
          resolve()
        } else {
          setTimeout(checkComplete, 10)
        }
      }
      checkComplete()
    })
  }

  /**
   * Get current progress
   */
  getProgress (): { completed: number, total: number, remaining: number } {
    return {
      completed: this.completed,
      total: this.total,
      remaining: this.total - this.completed
    }
  }

  /**
   * Check if the queue is currently running
   */
  get running (): boolean {
    return this.isRunning
  }

  /**
   * Check if all tasks are complete
   */
  get isComplete (): boolean {
    return this.completed >= this.total && this.activePromises.length === 0
  }

  /**
   * Clear all pending tasks (does not affect currently running tasks)
   */
  clear (): void {
    this.tasks = []
    this.total = this.completed + this.activePromises.length
  }

  private async processQueue (): Promise<void> {
    const executeNext = async (): Promise<void> => {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift()!

        try {
          await this.executor(task)
        } catch (error) {
          this.onError?.(error, task)
        }

        this.completed++
        this.onProgress?.(this.completed, this.total)
      }
    }

    // Start initial batch of concurrent executions
    const initialConcurrency = Math.min(this.concurrencyLimit, this.tasks.length)
    this.activePromises = []

    for (let i = 0; i < initialConcurrency; i++) {
      const promise = executeNext().then(() => {
        // Remove this promise from active list when done
        const index = this.activePromises.indexOf(promise)
        if (index > -1) {
          this.activePromises.splice(index, 1)
        }
      })
      this.activePromises.push(promise)
    }

    // Wait for all executions to complete
    await Promise.all(this.activePromises)
  }
}
