'use client'

import {
  IHubIconDownload,
  IHubIconPlus,
  IHubIconPython,
} from '@ihub/utils/icons'
import { TopMenuBar } from '../navigation/TopMenuBar'
import { TopMenuButton } from '../navigation/TopMenuButton'
import { Button, Container, Group, Select } from '@mantine/core'
import { useAddCellAtEnd } from './NotebookContext'
import {
  JupyterNotebookProvider,
  useJupyterNotebook,
  useSetJupyterNotebook,
} from './NotebookContext'

import { generateInsecureUUID } from '@ihub/utils/helpers/helpers'
import {
  AvailableKernelList,
  JupyterCell,
  JupyterNotebookFile,
  JupyterServerConfig,
  JupyterServerKernelConnection,
  JupyterServerKernelSession,
  JupyterSession,
} from '@ihub/utils/types/notebook'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createConnectionToJupyterSession, getNewSession } from './actions'
import { NotebookCodeCell, NotebookMarkdownCell } from './Cell'
import { updateNotebookExecutionActivity } from './NotebookActivity'
import { getNotebookDocumentPublishDecision } from './NotebookDocumentSync'
import { downloadJson } from '@ihub/utils/helpers/download'

interface NotebookProps {
  notebookData: JupyterNotebookFile
  jupyterServers: JupyterServerConfig[]
  setDocumentContent?: (
    notebookContent: JupyterNotebookFile['content'] | undefined,
    options?: { dirty?: boolean },
  ) => void
  onDocumentActivityChange?: (active: boolean) => void
}

export default function Notebook(props: NotebookProps) {
  return (
    <JupyterNotebookProvider>
      <NotebookComponent {...props} />
    </JupyterNotebookProvider>
  )
}

function NotebookComponent({
  notebookData,
  jupyterServers,
  setDocumentContent,
  onDocumentActivityChange,
}: NotebookProps) {
  const { state: allNoteBookData } = useJupyterNotebook()
  const { handleAction: setAllNoteBookData } = useSetJupyterNotebook()
  const [activeCellId, setActiveCellId] = useState<string | null>(null)
  const [availableKernels, setAvailableKernels] = useState<AvailableKernelList>(
    {},
  )

  const hasStartedNewKernel = useRef(false)
  const hydratedNotebookRef = useRef<JupyterNotebookFile | null>(null)
  const hasPublishedHydratedNotebookRef = useRef(false)
  const setDocumentContentRef = useRef(setDocumentContent)
  const onDocumentActivityChangeRef = useRef(onDocumentActivityChange)
  const executingCellIdsRef = useRef<Set<string>>(new Set())
  const documentActivityActiveRef = useRef(false)
  const [idlePublicationVersion, setIdlePublicationVersion] = useState(0)

  const [selectedJupyterSession, setSelectedJupyterSession] =
    useState<null | JupyterServerKernelConnection>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const kernels = await getAvailableKernels()
        const filteredKernels = Object.values(kernels).filter((k) => {
          return k.session?.name === notebookData.name
        })
        if (filteredKernels.length > 0) {
          if (filteredKernels[0]) handleSelectKernel(filteredKernels[0])
        } else {
          if (hasStartedNewKernel.current) return
          // If no matching kernel, start a new one
          console.log('need to start new kernel')
          const firstServer = jupyterServers[0]
          console.log('first server', firstServer)
          if (!firstServer) return
          const newKernel: JupyterServerKernelSession = {
            server: firstServer,
            session: null,
            new_kernel: true,
          }
          hasStartedNewKernel.current = true
          handleSelectKernel(newKernel)
        }

        setAvailableKernels(kernels)
      } catch (error) {
        console.error('Error fetching notebook data:', error)
      }
    })()

    const seenCellIds = new Set<string>()
    const normalizedNotebookData: JupyterNotebookFile = {
      ...notebookData,
      content: {
        ...notebookData.content,
        cells: (notebookData.content.cells || []).map((cell) => {
          const candidateId =
            cell.id || cell.metadata?.id || generateInsecureUUID()
          const normalizedId = seenCellIds.has(candidateId)
            ? generateInsecureUUID()
            : candidateId
          seenCellIds.add(normalizedId)

          return {
            ...cell,
            id: normalizedId,
          }
        }),
      },
    }

    hydratedNotebookRef.current = normalizedNotebookData
    setAllNoteBookData(normalizedNotebookData)
  }, [])

  useEffect(() => {
    setDocumentContentRef.current = setDocumentContent
  }, [setDocumentContent])

  useEffect(() => {
    onDocumentActivityChangeRef.current = onDocumentActivityChange
  }, [onDocumentActivityChange])

  useEffect(() => {
    if (!setDocumentContentRef.current || !allNoteBookData) {
      return
    }

    const publishDecision = getNotebookDocumentPublishDecision({
      hasPublishedHydratedNotebook: hasPublishedHydratedNotebookRef.current,
      isHydratedNotebookSnapshot:
        allNoteBookData === hydratedNotebookRef.current,
    })

    if (!publishDecision.shouldPublish) {
      return
    }

    setDocumentContentRef.current(allNoteBookData.content, {
      dirty: publishDecision.dirty,
    })

    if (!hasPublishedHydratedNotebookRef.current) {
      hasPublishedHydratedNotebookRef.current = true
    }
  }, [allNoteBookData])

  /**
   * Aggregates code-cell execution and defers the final idle signal until the
   * notebook state publishing effect above has committed the last update.
   */
  const handleCellExecutionChange = useCallback(
    (cellId: string, active: boolean) => {
      const activityUpdate = updateNotebookExecutionActivity(
        executingCellIdsRef.current,
        cellId,
        active,
      )
      if (!activityUpdate.didChange) {
        return
      }

      executingCellIdsRef.current = activityUpdate.executingCellIds

      if (activityUpdate.didBecomeActive) {
        documentActivityActiveRef.current = true
        onDocumentActivityChangeRef.current?.(true)
      } else if (activityUpdate.didBecomeIdle) {
        setIdlePublicationVersion((version) => version + 1)
      }
    },
    [],
  )

  useEffect(() => {
    if (
      idlePublicationVersion > 0 &&
      executingCellIdsRef.current.size === 0 &&
      documentActivityActiveRef.current
    ) {
      documentActivityActiveRef.current = false
      onDocumentActivityChangeRef.current?.(false)
    }
  }, [allNoteBookData, idlePublicationVersion])

  useEffect(
    () => () => {
      executingCellIdsRef.current.clear()
      if (documentActivityActiveRef.current) {
        documentActivityActiveRef.current = false
        onDocumentActivityChangeRef.current?.(false)
      }
    },
    [],
  )

  // update the list of available kernels
  useEffect(() => {
    ;(async () => {
      const kernels: { [key: string]: JupyterServerKernelSession } =
        await getAvailableKernels()
      setAvailableKernels(kernels)
    })()
  }, [selectedJupyterSession])

  function handleSelectKernel(k: JupyterServerKernelSession) {
    if (k.new_kernel) {
      // Create a KernelManager instance
      console.log('getting a new session for ', notebookData.name)
      getNewSession(k.server, notebookData.name)
        .then((session) => {
          console.log('new session', session)
          createConnectionToJupyterSession(session, k.server).then(
            (connection) => {
              console.log('new connection', connection)
              console.log(session)
              setSelectedJupyterSession({
                server: k.server,
                session: session,
                connection: connection,
              })
            },
          )
        })
        .catch((err) => {
          console.error(err)
        })
    } else {
      createConnectionToJupyterSession(k.session, k.server)
        .then((connection) => {
          setSelectedJupyterSession({
            server: k.server,
            session: k.session,
            connection: connection,
          })
        })
        .catch((error) => {
          console.error(error)
        })
    }
  }

  async function getAvailableKernels(): Promise<{
    [key: string]: JupyterServerKernelSession
  }> {
    const kernels: { [key: string]: JupyterServerKernelSession } = {}
    const promises = jupyterServers?.map((item) =>
      fetch(`${item.url}/api/sessions`, {
        headers: {
          Authorization: `Bearer ${item.token}`,
          'Content-Type': 'application/json',
        },
      }).then((response) => response.json()),
    )

    await Promise.allSettled(promises).then((responses) => {
      responses.map((res, serverIdx) => {
        if (res.status == 'fulfilled') {
          res.value.map((session: JupyterSession) => {
            kernels[session.id] = {
              server: {
                id: jupyterServers[serverIdx]!.id,
                url: jupyterServers[serverIdx]!.url,
                token: jupyterServers[serverIdx]!.token,
                label: jupyterServers[serverIdx]!.label,
              },
              session: session,
              new_kernel: false,
            }
          })

          kernels[`start_new_kernel_${serverIdx}`] = {
            server: {
              id: jupyterServers[serverIdx]!.id,
              url: jupyterServers[serverIdx]!.url,
              token: jupyterServers[serverIdx]!.token,
              label: jupyterServers[serverIdx]!.label,
            },
            session: null,
            new_kernel: true,
          }
        }
      })
    })

    return kernels
  }

  return (
    <div>
      <TopMenuBar
        leftItems={<></>}
        rightItems={
          <>
            <Select
              className='ms-auto'
              p={0}
              m={0}
              variant={'subtle'}
              data={Object.keys(availableKernels).map((item) => ({
                value: item,
                label: availableKernels[item]!.new_kernel
                  ? `Start new kernel (${availableKernels[item]!.server.label})`
                  : `${availableKernels[item]!.session!.name} (${availableKernels[item]!.server.label} - ${item.split('-')[0]})`,
              }))}
              leftSectionPointerEvents='none'
              leftSection={<IHubIconPython size={15} stroke={1} />}
              size='xs'
              radius={'xl'}
              placeholder='Select a kernel'
              w={300}
              onChange={(value) => {
                if (value !== null) {
                  const selected = availableKernels[value]
                  if (selected) handleSelectKernel(selected)
                }
              }}
              value={selectedJupyterSession?.session.id}
            />

            <TopMenuButton
              Icon={IHubIconDownload}
              hoverInfo='Download notebook'
              onClick={() => {
                downloadJson(allNoteBookData!.name, allNoteBookData)
              }}
            />
          </>
        }
      />

      <Container fluid p={'md'} m={'lg'}>
        {allNoteBookData?.content.cells?.map((cell, i) => {
          switch (cell.cell_type) {
            case 'code':
              return (
                <NotebookCodeCell
                  cellContent={cell}
                  key={`cell-${cell.id}`}
                  jupyterSession={selectedJupyterSession}
                  isActive={activeCellId === cell.id}
                  setActiveCellId={setActiveCellId}
                  cellIndex={i}
                  nextCellId={
                    allNoteBookData?.content.cells?.[i + 1]?.id ?? null
                  }
                  onExecutionChange={handleCellExecutionChange}
                />
              )

            case 'markdown':
              return (
                <NotebookMarkdownCell
                  cellContent={cell}
                  key={`cell-${cell.id}`}
                  isActive={activeCellId === cell.id}
                  setActiveCellId={setActiveCellId}
                  cellIndex={i}
                />
              )

            default:
              return <code>Unknown cell type</code>
          }
        })}

        <NotebookAddCell setActiveCellId={setActiveCellId} />
      </Container>
    </div>
  )
}

function NotebookAddCell({ setActiveCellId }: { setActiveCellId: any }) {
  const { handleAction: addCellAtEnd } = useAddCellAtEnd()

  const addCodeCell = () => {
    const newCodeCell: JupyterCell = {
      // id: crypto.randomUUID(),
      id: generateInsecureUUID(),
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: '',
    }

    // add cell to the end of the list of cells
    addCellAtEnd(newCodeCell)
    setActiveCellId(newCodeCell.id)
  }

  const addMarkdownCell = () => {
    const newMdCell: JupyterCell = {
      id: generateInsecureUUID(),
      cell_type: 'markdown',
      metadata: {},
      source: '',
    }

    // add cell to the end of the list of cells
    addCellAtEnd(newMdCell)
    setActiveCellId(newMdCell.id)
  }

  return (
    <>
      <div className='mx-auto my-auto w-full'>
        <Group
          className='mx-auto w-full'
          style={{ display: 'flex', justifyContent: 'center' }}
        >
          <Button
            variant={'subtle'}
            size='xs'
            radius={'xl'}
            onClick={addCodeCell}
          >
            <IHubIconPlus className='me-2' />
            Add Cell
          </Button>

          <Button
            variant={'subtle'}
            size='xs'
            radius={'xl'}
            onClick={addMarkdownCell}
          >
            <IHubIconPlus className='me-2' />
            Add Markdown
          </Button>
        </Group>
      </div>
    </>
  )
}
