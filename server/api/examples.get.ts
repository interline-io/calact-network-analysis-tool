import { readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { GenericStreamReceiver } from '~~/src/core'

interface ProgressData {
  isLoading: boolean
  currentStage: string
  config?: any
  error?: any
}

interface ExampleFileData {
  filename: string
  config?: any
  error?: string
}

// Stream data receiver that looks for config in progress events
class ConfigReceiver {
  private config?: any
  private error?: string

  onProgress (progress: ProgressData): void {
    if (progress.config) {
      this.config = progress.config
    }
    if (progress.error) {
      this.error = progress.error.message || 'Unknown error'
    }
  }

  onComplete (): void {
    // No special action needed on completion
  }

  onError (error: any): void {
    this.error = error.message || 'Stream processing error'
  }

  getCurrentData (): { config?: any, error?: string } {
    return { config: this.config, error: this.error }
  }
}

async function processJsonFile (filePath: string, examplesDir: string): Promise<ExampleFileData> {
  // Get relative path from examples directory
  const filename = filePath.replace(examplesDir + '/', '')

  try {
    // Create a ReadableStream that reads the file line by line
    const stream = new ReadableStream({
      start (controller) {
        const encoder = new TextEncoder()
        const fileStream = createReadStream(filePath, { encoding: 'utf8' })
        const rl = createInterface({
          input: fileStream,
          crlfDelay: Infinity // Handle Windows line endings properly
        })

        rl.on('line', (line) => {
          // Encode each line and add newline back
          controller.enqueue(encoder.encode(line + '\n'))
        })

        rl.on('close', () => {
          controller.close()
        })

        rl.on('error', (error) => {
          controller.error(error)
        })
      }
    })

    const receiver = new ConfigReceiver()
    const streamReceiver = new GenericStreamReceiver<ProgressData, { config?: any, error?: string }>()
    const { data } = await streamReceiver.processStream(stream, receiver)

    return {
      filename,
      config: data.config,
      error: data.error || undefined
    }
  } catch (error) {
    return {
      filename,
      config: undefined,
      error: error instanceof Error ? error.message : 'Unknown error processing file'
    }
  }
}

async function findJsonFilesRecursively (dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      const subFiles = await findJsonFilesRecursively(fullPath)
      files.push(...subFiles)
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath)
    }
  }

  return files
}

async function buildExamplesIndex (): Promise<any> {
  const examplesDir = join(process.cwd(), 'public/examples')

  // Find all JSON files recursively
  const jsonFiles = await findJsonFilesRecursively(examplesDir)

  // Filter out the index.json file itself
  const filteredFiles = jsonFiles.filter(file => !file.endsWith('index.json'))

  // Process each JSON file
  const results: ExampleFileData[] = []

  for (const filePath of filteredFiles) {
    const result = await processJsonFile(filePath, examplesDir)
    results.push(result)
  }

  // Create the index
  return {
    generated: new Date().toISOString(),
    files: results.map(result => ({
      filename: result.filename,
      config: result.config,
      hasError: !!result.error,
      error: result.error
    }))
  }
}

export default defineEventHandler(async () => {
  try {
    const index = await buildExamplesIndex()
    return index
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : 'Error building examples index'
    })
  }
})
