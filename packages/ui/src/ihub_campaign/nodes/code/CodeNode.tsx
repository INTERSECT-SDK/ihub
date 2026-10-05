import { useState } from 'react'
import { Badge } from '@mantine/core'
import { Position } from '@xyflow/react'
import type { CodeNode } from '@ihub/utils/types/campaign'
import { IHubIconEdit, IHubIconPlay, IHubIconPython } from '@ihub/utils/icons'

import BaseNode from '../common/BaseNode'
import { defaultNodeStyle, nodeStyleMap } from '../common/nodeStyles'
import { CodeNodeCells } from './CodeNodeCells'
import type { NodeActionDescriptor } from '../common/nodeActions'
import { useCodeNodeSession } from './useCodeNodeSession'

function CodeNodeTitle({ data }: { data: CodeNode }) {
  const { iconBackground } = nodeStyleMap.code || defaultNodeStyle

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div
        style={{
          backgroundColor: iconBackground,
          borderRadius: '50%',
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          flexShrink: 0,
        }}
      >
        <IHubIconPython size={14} />
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>{data.name}</div>
        <div style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
          Kernel {data.kernel.kernel.id.split('-')[0]}
        </div>
      </div>
    </span>
  )
}

function CodeNodeTag({ color }: { color?: string }) {
  return (
    <Badge h={20} size='xs' me='sm' color={color}>
      Code
    </Badge>
  )
}

/** Renders Code metadata and graph handles without opening an editor session. */
export function CodeNodePassiveCard({
  id,
  data,
}: {
  id: string
  data: CodeNode
}) {
  const { background, border, iconBackground } =
    nodeStyleMap.code || defaultNodeStyle

  return (
    <BaseNode
      id={id}
      title={<CodeNodeTitle data={data} />}
      tags={<CodeNodeTag color={iconBackground} />}
      style={{ background, border }}
      handleColor={iconBackground}
      outputPositions={Position.Right}
    />
  )
}

/** Renders a campaign graph node backed by one or more Jupyter code cells. */
export default function JupyterCodeNode({
  id,
  data,
  onDelete,
}: {
  id: string
  data: CodeNode
  onDelete: () => void
}) {
  const { background, border, iconBackground } =
    nodeStyleMap['code'] || defaultNodeStyle
  const [isHovered, setIsHovered] = useState(false)
  const {
    activeCell,
    cells,
    executeCell,
    executionStateByCell,
    setActiveCellId,
    setCells,
    provenanceKey,
    readOnly,
    canMutate,
  } = useCodeNodeSession(id, data)

  const actions: NodeActionDescriptor[] = [
    {
      id: 'run',
      label: 'Run',
      tooltip: 'Run',
      icon: <IHubIconPlay size={16} />,
      onSelect: () => void executeCell(activeCell.id),
      disabled: readOnly,
    },
    {
      id: 'rename',
      label: 'Rename',
      tooltip: 'Rename',
      icon: <IHubIconEdit size={16} />,
      onSelect: () => alert('TODO'),
    },
  ]

  return (
    <BaseNode
      id={id}
      title={<CodeNodeTitle data={data} />}
      actions={actions}
      onDelete={onDelete}
      tags={<CodeNodeTag color={iconBackground} />}
      style={{
        background,
        border,
        boxShadow: isHovered
          ? '0 0 12px rgba(255, 255, 255, 0.1), 0 8px 16px rgba(0, 0, 0, 0.15)'
          : 'none',
        transition: 'background 0.2s, box-shadow 0.2s',
      }}
      handleColor={iconBackground}
      outputPositions={Position.Right}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CodeNodeCells
        key={provenanceKey}
        cells={cells}
        activeCellId={activeCell.id}
        runCode={(cellId, sourceOverride) => {
          if (canMutate(provenanceKey)) {
            void executeCell(cellId, sourceOverride)
          }
        }}
        setCellInput={(cellId, input) => {
          if (!canMutate(provenanceKey)) return
          setCells((previousCells) =>
            previousCells.map((cell) =>
              cell.id === cellId ? { ...cell, source: input } : cell,
            ),
          )
        }}
        setActiveCellId={setActiveCellId}
        executionStateByCell={executionStateByCell}
        readOnly={readOnly}
      />
    </BaseNode>
  )
}
