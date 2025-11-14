import { readdir, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { Command } from 'commander'
import { GenericStreamReceiver } from '../src/core'

interface ProgressData {
  isLoading: boolean
  currentStage: string
  config?: any
  error?: any
}

interface ExampleFileData {
  filename: string
  config: any | null
  error?: string
}

// Stream data receiver that looks for config in progress events
class ConfigReceiver {
  private config: any | null = null
  private error: string | null = null

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

  getCurrentData (): { config: any | null, error: string | null } {
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
    const streamReceiver = new GenericStreamReceiver<ProgressData, { config: any | null, error: string | null }>()
    const result = await streamReceiver.processStream(stream, receiver)

    return {
      filename,
      config: result.config,
      error: result.error || undefined
    }
  } catch (error) {
    return {
      filename,
      config: null,
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

async function buildExamplesIndex (verbose = false): Promise<void> {
  const examplesDir = join(process.cwd(), 'public/examples')

  try {
    // Find all JSON files recursively
    const jsonFiles = await findJsonFilesRecursively(examplesDir)

    // Filter out the index.json file itself
    const filteredFiles = jsonFiles.filter(file => !file.endsWith('index.json'))

    if (verbose) {
      console.log(`Found ${filteredFiles.length} JSON files to process...`)
    }

    // Process each JSON file
    const results: ExampleFileData[] = []

    for (const filePath of filteredFiles) {
      const relativePath = filePath.replace(examplesDir + '/', '')
      if (verbose) {
        console.log(`Processing ${relativePath}...`)
      }
      const result = await processJsonFile(filePath, examplesDir)
      results.push(result)

      if (verbose) {
        if (result.error) {
          console.warn(`  Warning: ${result.error}`)
        } else if (result.config) {
          console.log(`  Found config: ${result.config.reportName || 'Unnamed report'}`)
        } else {
          console.warn(`  No config found`)
        }
      }
    }

    // Create the index
    const index = {
      generated: new Date().toISOString(),
      files: results.map(result => ({
        filename: result.filename,
        config: result.config,
        hasError: !!result.error,
        error: result.error
      }))
    }

    // Write the index file
    const indexPath = join(examplesDir, 'index.json')
    await writeFile(indexPath, JSON.stringify(index, null, 2))

    console.log(`Index created successfully at ${indexPath}`)
    if (verbose) {
      console.log(`Processed ${results.length} files`)
      console.log(`Found configs in ${results.filter(r => r.config).length} files`)
      console.log(`Errors in ${results.filter(r => r.error).length} files`)
    }
  } catch (error) {
    console.error('Error building examples index:', error)
    process.exit(1)
  }
}

export function configureBuildExamplesIndexCli (command: Command): void {
  command
    .description('Build an index of example files and their configurations')
    .option('-v, --verbose', 'Enable verbose output', false)
    .action(async (options) => {
      await buildExamplesIndex(options.verbose)
    })
}
