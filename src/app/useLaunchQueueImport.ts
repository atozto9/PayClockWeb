import { useEffect, useEffectEvent } from 'react'

interface FileSystemFileHandleLike {
  getFile: () => Promise<File>
}

interface LaunchParamsLike {
  files?: FileSystemFileHandleLike[]
}

interface WindowWithLaunchQueue extends Window {
  launchQueue?: {
    setConsumer: (consumer: (params: LaunchParamsLike) => void | Promise<void>) => void
  }
}

export function useLaunchQueueImport(onImportFile: (file: File) => Promise<void> | void) {
  const handleLaunch = useEffectEvent(async (params: LaunchParamsLike) => {
    const fileHandle = params.files?.[0]
    if (!fileHandle) {
      return
    }

    const file = await fileHandle.getFile()
    await onImportFile(file)
  })

  useEffect(() => {
    const windowWithLaunchQueue = window as WindowWithLaunchQueue
    if (typeof windowWithLaunchQueue.launchQueue?.setConsumer !== 'function') {
      return undefined
    }

    windowWithLaunchQueue.launchQueue.setConsumer((params) => {
      void handleLaunch(params)
    })

    return undefined
  }, [])
}
