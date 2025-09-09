/**
 * Check environemnt config
 */
export function checkTransitlandEnv () {
  const apiEndpoint = process.env.TRANSITLAND_API_BASE
  const apiKey = process.env.TRANSITLAND_API_KEY

  if (!apiEndpoint) {
    console.error('❌ Error: TRANSITLAND_API_BASE environment variable is required')
    console.error('   Please set it to your TransitLand GraphQL API endpoint')
    console.error('   Example: export TRANSITLAND_API_BASE="https://api.transit.land/api/v2"')
    throw new Error('Missing TRANSITLAND_API_BASE environment variable')
  }

  if (!apiKey) {
    console.error('❌ Error: TRANSITLAND_API_KEY environment variable is required')
    console.error('   Please set it to your TransitLand API key')
    console.error('   Example: export TRANSITLAND_API_KEY="your_api_key_here"')
    throw new Error('Missing TRANSITLAND_API_KEY environment variable')
  }
}

export function createStreamController (saveToFile?: string): ReadableStreamDefaultController {
  let controller: ReadableStreamDefaultController

  const stream = new ReadableStream({
    start (ctrl) {
      controller = ctrl
    }
  })

  if (saveToFile) {
    // Set up file writing in the background
    const reader = stream.getReader()
    const decoder = new TextDecoder()

    // Import fs dynamically to handle Node.js environment
    import('fs').then(async (fs) => {
      const writeStream = fs.createWriteStream(saveToFile)

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value)
          writeStream.write(text)
        }
      } catch (error) {
        console.error('Error writing to file:', error)
      } finally {
        writeStream.end()
        reader.releaseLock()
      }
    }).catch((error) => {
      console.error('Error importing fs module:', error)
    })
  }
  // If saveToFile is not provided, the stream just acts as a dummy
  // The controller will still work but data won't be written anywhere
  return controller!
}
