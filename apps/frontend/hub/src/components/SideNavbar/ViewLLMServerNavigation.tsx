import {
  Accordion,
  AccordionControl,
  AccordionItem,
  AccordionPanel,
  Button,
  Divider,
  Group,
  Text,
} from '@mantine/core'
import { useEffect, useState, ReactNode } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useAtomValue } from 'jotai'
import {
  AddConnectionButton,
  EditConnection,
  ServerHeader,
  SortDropdown,
} from './ViewCommonComponents.tsx'
import { selectedProjectIdAtom } from '@/atoms/global.ts'
import { LLMServer } from '@ihub/utils/types/chat'
import { FieldDef } from '@ihub/utils/types/types'
import { IHubIconEdit, IHubIconTrash } from '@ihub/utils/icons'

interface DisplayLLMServerStatusProps {
  icon: ReactNode
}

const defaultLLMFields: FieldDef[] = [
  {
    name: 'label',
    label: 'Name',
    type: 'text',
    placeholder: 'Enter a label for the LLM server',
    required: true,
  },
  {
    name: 'url',
    label: 'URL',
    type: 'text',
    placeholder: 'Enter the LLM server URL',
    required: true,
  },
  {
    name: 'provider',
    label: 'LLM Provider',
    type: 'select',
    options: ['ollama', 'azure'],
    placeholder: 'Select provider from list',
    required: true,
  },
  {
    name: 'model',
    label: 'Model',
    type: 'text',
    placeholder: 'Enter the LLM model name',
    required: true,
  },
  {
    name: 'api_key',
    label: 'API Key',
    type: 'password',
    placeholder: 'Enter LLM server API key',
    required: false,
  },
  {
    name: 'api_version',
    label: 'API Version',
    type: 'text',
    placeholder: 'Version (e.g. 2024-12-01-preview)',
    required: true,
    hidden: (formValues) => formValues.provider !== 'azure',
  },
  {
    name: 'deployment_name',
    label: 'Deployment Name',
    type: 'text',
    placeholder: 'Enter name found in Deployment Info',
    required: true,
    hidden: (formValues) => formValues.provider !== 'azure',
  },
]

export default function DisplayLLMServerStatus({
  icon,
}: DisplayLLMServerStatusProps) {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortedLLMs, setSortedLLMs] = useState<LLMServer[]>([])
  const [addLLMServer, setAddLLMServer] = useState<boolean>(false)

  const [isError, setIsError] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const [editId, setEditId] = useState<number | null>(null)
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)
  const llmUrl = selectedProjectId
    ? `/api/v1/llm?project_id=${selectedProjectId}`
    : '/api/v1/llm'

  /* Use to manual trigger fetch */
  const { mutate } = useSWRConfig()

  /* Fetch LLM information from server */
  const { data: llms } = useSWR(llmUrl, async (url: string) => {
    const response = await fetch(url)
    const llms = await response.json()
    return llms as LLMServer[]
  })

  useEffect(() => {
    if (sortBy !== null) {
      const sorted = llms?.sort((a, b) => (a[sortBy] > b[sortBy] ? 1 : -1))
      setSortedLLMs(sorted || [])
    }
  }, [sortBy, llms])

  /**
   * Send a request to delete an LLM server.
   * @param llmID LLM server ID.
   */
  async function submitDelete(llmID: number) {
    const response = await fetch(`/api/v1/llm/${llmID}`, {
      method: 'DELETE',
    })
    console.log(response)

    if (!response.ok) {
      setIsError(true)
      setErrorMsg('Error: LLM Not Deleted')
    } else {
      mutate(llmUrl)
      setIsSuccess(true)
      setSuccessMsg('LLM Deleted Successfully')
    }
  }

  return (
    <>
      <AddConnectionButton
        serverType={'LLM server'}
        handleClick={() => setAddLLMServer(!addLLMServer)}
        fields={defaultLLMFields}
        url={'/api/v1/llm'}
        expand={addLLMServer}
        buttonLabel='Create new LLM server'
        formTitle='Create new LLM server'
      />

      <SortDropdown options={['status', 'label']} setSortBy={setSortBy} />

      <Accordion mx={'sm'} variant='separated' radius={'md'}>
        {llms?.map((llm) => (
          <AccordionItem
            mt={0}
            key={`server_type_${llm.label}`}
            value={llm.label || 'No Name'}
          >
            <AccordionControl icon={icon}>
              <LLMServerItem server={llm} />
            </AccordionControl>
            <AccordionPanel>
              <Group gap='sm' grow>
                <Button
                  color='var(--mantine-color-red-6)'
                  onClick={() => submitDelete(llm.id as number)}
                  leftSection={<IHubIconTrash size={16} />}
                  size='xs'
                  variant='light'
                  radius={'xl'}
                >
                  Delete
                </Button>
                <Button
                  size='xs'
                  radius={'xl'}
                  variant='light'
                  color='var(--mantine-color-gray-8)'
                  leftSection={<IHubIconEdit size={16} />}
                  onClick={() => setEditId(llm.id as number)}
                >
                  Edit
                </Button>
              </Group>

              <Divider my='sm' />
              <Text size='sm'>Provider: {llm.provider}</Text>
              <Text size='sm'>Model: {llm.model}</Text>
              {llm.api_version && (
                <Text size='sm'>Version: {llm.api_version}</Text>
              )}
              {llm.deployment_name && (
                <Text size='sm'>Deployment: {llm.deployment_name}</Text>
              )}
            </AccordionPanel>
            {editId && editId === (llm.id as number) && (
              <AccordionPanel>
                <EditConnection
                  serverType={'LLM server'}
                  handleClick={() => setEditId(null)}
                  fields={defaultLLMFields}
                  url={'/api/v1/llm/' + editId}
                  currentValues={llm}
                  onSuccess={() => mutate(llmUrl)}
                />
              </AccordionPanel>
            )}
          </AccordionItem>
        ))}
      </Accordion>
    </>
  )
}

/**
 * helper component for each server
 */
interface LLMServerItemProps {
  server: LLMServer
}

function LLMServerItem({ server }: LLMServerItemProps) {
  /* TODO send a test chat to LLM */
  // const { data, error, isLoading } = useSWR(
  //   `${server.url}/api/generate`,
  //   fetcher,
  // )

  const status = 'connected' // temporary
  // if (isLoading) {
  //   status = 'connecting'
  // } else if (error) {
  //   status = 'failed'
  // } else if (data) {
  //   status = 'connected'
  // }

  return (
    <>
      <ServerHeader
        url={`${server.url}`}
        label={server.label}
        status={status}
      />
    </>
  )
}
