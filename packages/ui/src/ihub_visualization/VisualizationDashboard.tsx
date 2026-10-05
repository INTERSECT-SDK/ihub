'use client'
import { TopMenuBar } from '../navigation/TopMenuBar'
import { useState } from 'react'
import { Box, Card, Container, Grid, Menu, MenuItem } from '@mantine/core'
import { TopMenuButton } from '../navigation/TopMenuButton'
import { IHubIconPlus } from '@ihub/utils/icons'
import { VegaVisualization } from './vega_components/VegaVisualization'
import { vegaDefaultOptions } from './vega_components/VegaDefaultOptions'
import { VisualizationFileContent } from '@ihub/utils/types/visualization'
import { generateInsecureUUID } from '@ihub/utils/helpers/helpers'
import {
  visualizationRegistry,
  visualizationRegistryByType,
  VisualizationRegistryEntry,
} from './vega_components/RegisteredVegaVisualizations'

interface AddVisualizationMenuProps {
  handleAddVis: (entry: VisualizationRegistryEntry) => void
}

function AddVisualizationMenu({ handleAddVis }: AddVisualizationMenuProps) {
  const [menuOpened, setMenuOpened] = useState(false)

  return (
    <Menu
      shadow='md'
      position={'bottom-start'}
      openDelay={100}
      closeDelay={200}
      opened={menuOpened}
      onChange={setMenuOpened}
      withinPortal={false}
    >
      <Menu.Target>
        <TopMenuButton
          Icon={IHubIconPlus}
          hoverInfo='Add visualization'
          onClick={() => setMenuOpened((open) => !open)}
        />
      </Menu.Target>
      <Menu.Dropdown mt={'35px'}>
        {visualizationRegistry.map(
          (visType: VisualizationRegistryEntry, visTypeIdx: number) => (
            <MenuItem
              key={`add-vis-btn-${visTypeIdx}`}
              onClick={() => handleAddVis(visType)}
            >
              {visType.name}
            </MenuItem>
          ),
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

interface VisualizationDashboardProps {
  visualizationData: VisualizationFileContent
  setDocumentContent: (
    visualizationData: VisualizationFileContent,
    options?: { dirty?: boolean },
  ) => void
}

export default function VisualizationDashboard({
  visualizationData,
  setDocumentContent,
}: VisualizationDashboardProps) {
  const handleAddVis = (visType: VisualizationRegistryEntry) => {
    setDocumentContent({
      ...visualizationData,
      visualizations: [
        ...visualizationData.visualizations,
        {
          type: visType.type,
          id: `vegavis-${generateInsecureUUID()}`,
          spec: visType.createSpec(),
        },
      ],
    })
  }

  return (
    <div
      style={{
        position: 'relative',
      }}
    >
      <TopMenuBar
        rightItems={<></>}
        leftItems={
          <>
            <AddVisualizationMenu handleAddVis={handleAddVis} />
          </>
        }
      />

      <Container p={'sm'} m={'none'} w={'100%'} maw={'100%'}>
        <Grid>
          {visualizationData.visualizations.map((visData, visIdx) => (
            <Box key={`plot-${visIdx}`}>
              <Card p={'sm'} m={'sm'} withBorder>
                {(() => {
                  const entry = visData.type
                    ? visualizationRegistryByType[visData.type]
                    : undefined
                  const RegistryComponent = entry?.component

                  if (RegistryComponent) {
                    return (
                      <RegistryComponent
                        visData={visData}
                        options={vegaDefaultOptions}
                      />
                    )
                  }

                  return (
                    <VegaVisualization
                      visData={visData}
                      options={vegaDefaultOptions}
                    />
                  )
                })()}
              </Card>
            </Box>
          ))}
        </Grid>
      </Container>
    </div>
  )
}
