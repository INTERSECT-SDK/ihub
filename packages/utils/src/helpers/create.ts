import { Spec } from 'vega'
import { CampaignModelFile } from '../types/campaign'
import { ChatData, ChatFile } from '../types/chat'
import { JupyterNotebookFile } from '../types/notebook'
import { VisualizationFile } from '../types/visualization'
import { v4 as uuidv4 } from 'uuid'

export function createEmptyDocument(fileName: string, fileType: string) {
  const creationDateTime = new Date()

  switch (fileType) {
    case 'ichat':
      return createEmptyChat(fileName)

    case 'ipynb':
      return createEmptyNotebook(fileName)

    case 'icmp':
      return createEmptyCampaignModel(fileName)
  }
}

export function createEmptyNotebook(fileName: string): JupyterNotebookFile {
  const creationDateTime = new Date()

  return {
    type: 'notebook',
    format: 'json',
    name: `${fileName}`,
    content: {
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    },
    createdAt: creationDateTime.toISOString(),
    updatedAt: creationDateTime.toISOString(),
  }
}

export function createEmptyChat(fileName: string): ChatFile {
  const creationDateTime = new Date()

  return {
    type: 'file',
    format: 'text',
    name: `${fileName}`,
    content: {
      chatId: uuidv4(),
      chatName: fileName,
      participants: [],
      messages: [],
      createdAt: creationDateTime.toISOString(),
      updatedAt: creationDateTime.toISOString(),
    },
    createdAt: creationDateTime.toISOString(),
    updatedAt: creationDateTime.toISOString(),
  }
}

export function createEmptyCampaignModel(fileName: string): CampaignModelFile {
  const creationDateTime = new Date()

  return {
    type: 'file',
    format: 'text',
    name: `${fileName}`,
    content: {
      id: uuidv4(),
      run_id: uuidv4(),
      name: fileName,
      user: 'system',
      description: '',
      task_groups: [],
      objectives: null,
      inputs: [],
      outputs: [],
    },
    createdAt: creationDateTime.toISOString(),
    updatedAt: creationDateTime.toISOString(),
  }
}

/** Visualizations */

// export function createEmptyVegaVisualizationDocument(
//   fileName: string,
// ): VisualizationFile {
//   const creationDateTime = new Date()

//   return {
//     type: 'file',
//     format: 'text',
//     name: `${fileName}`,
//     content: {
//       visualizations: [],
//     },
//     createdAt: creationDateTime.toISOString(),
//     updatedAt: creationDateTime.toISOString(),
//   }
// }

export function createNewVegaVisualization(vis_type: string): Spec {
  const visSpec: Spec = {
    $schema: 'https://vega.github.io/schema/vega/v6.json',
    description: 'title',
    width: 340,
    height: 220,
    autosize: { type: 'fit', contains: 'padding' },
    padding: { left: 5, right: 5, top: 5, bottom: 5 },
  }

  switch (vis_type) {
    case 'vega-pie':
      return makeSpecForPie(visSpec)

    case 'vega-line':
      return makeSpecForLine(visSpec)

    case 'vega-bar':
      return makeSpecForBar(visSpec)

    case 'vega-scatter':
      return makeSpecForScatter(visSpec)

    case 'vega-histogram':
      return makeSpecForHistogram(visSpec)

    case 'vega-violin':
      return makeSpecForViolin(visSpec)
  }

  return visSpec
}

function makeSpecForPie(visSpec: Spec): Spec {
  visSpec.data = [
    {
      name: 'table',
      values: [
        { category: 'A', value: 4 },
        { category: 'B', value: 6 },
        { category: 'C', value: 10 },
        { category: 'D', value: 3 },
        { category: 'E', value: 7 },
      ],
      transform: [
        {
          type: 'pie',
          field: 'value',
        },
      ],
    },
  ]

  visSpec.scales = [
    {
      name: 'color',
      type: 'ordinal',
      domain: { data: 'table', field: 'category' },
      range: { scheme: 'category20' },
    },
  ]

  visSpec.marks = [
    {
      type: 'arc',
      from: { data: 'table' },
      encode: {
        enter: {
          fill: { scale: 'color', field: 'category' },
          x: { signal: 'height / 2' },
          y: { signal: 'height / 2' },
          tooltip: { signal: "datum.category + ': ' + datum.value" },
        },
        update: {
          startAngle: { field: 'startAngle' },
          endAngle: { field: 'endAngle' },
          outerRadius: { signal: 'height / 2' },
        },
      },
    },
  ]

  visSpec.legends = [
    {
      fill: 'color',
      title: 'Category',
      orient: 'right',
      offset: -100,
    },
  ]

  return visSpec
}

function makeSpecForLine(visSpec: Spec): Spec {
  visSpec.data = [
    {
      name: 'table',
      values: [
        { x: 0, y: 28, c: 0 },
        { x: 0, y: 20, c: 1 },
        { x: 1, y: 43, c: 0 },
        { x: 1, y: 35, c: 1 },
        { x: 2, y: 81, c: 0 },
        { x: 2, y: 10, c: 1 },
        { x: 3, y: 19, c: 0 },
        { x: 3, y: 15, c: 1 },
        { x: 4, y: 52, c: 0 },
        { x: 4, y: 48, c: 1 },
        { x: 5, y: 24, c: 0 },
        { x: 5, y: 28, c: 1 },
        { x: 6, y: 87, c: 0 },
        { x: 6, y: 66, c: 1 },
        { x: 7, y: 17, c: 0 },
        { x: 7, y: 27, c: 1 },
        { x: 8, y: 68, c: 0 },
        { x: 8, y: 16, c: 1 },
        { x: 9, y: 49, c: 0 },
        { x: 9, y: 25, c: 1 },
      ],
    },
  ]

  visSpec.axes = [
    {
      orient: 'bottom',
      scale: 'x',
      tickCount: 5,
      labelOverlap: 'parity',
      format: '.2f',
      title: 'X-Axis',
    },
    { orient: 'left', scale: 'y', format: '.2f', title: 'Y-Axis' },
  ]

  visSpec.scales = [
    {
      name: 'x',
      type: 'linear',
      range: 'width',
      nice: true,
      zero: false,
      domain: { data: 'table', field: 'x' },
    },
    {
      name: 'y',
      type: 'linear',
      range: 'height',
      nice: true,
      zero: true,
      domain: { data: 'table', field: 'y' },
    },
    {
      name: 'color',
      type: 'ordinal',
      range: 'category',
      domain: { data: 'table', field: 'c' },
    },
  ]

  visSpec.marks = [
    {
      type: 'group',
      from: {
        facet: {
          name: 'series',
          data: 'table',
          groupby: 'c',
        },
      },
      marks: [
        {
          type: 'line',
          from: { data: 'series' },
          encode: {
            enter: {
              x: { scale: 'x', field: 'x' },
              y: { scale: 'y', field: 'y' },
              stroke: { scale: 'color', field: 'c' },
              strokeWidth: { value: 2 },
            },
            update: {
              interpolate: { value: 'basis' },
              strokeOpacity: { value: 1 },
            },
            hover: {
              strokeOpacity: { value: 0.5 },
            },
          },
        },
      ],
    },
  ]

  return visSpec
}

function makeSpecForBar(visSpec: Spec): Spec {
  visSpec.data = [
    {
      name: 'table',
      values: [
        { category: 'A', amount: 28 },
        { category: 'B', amount: 55 },
        { category: 'C', amount: 43 },
        { category: 'D', amount: 91 },
        { category: 'E', amount: 81 },
        { category: 'F', amount: 53 },
        { category: 'G', amount: 19 },
        { category: 'H', amount: 87 },
      ],
    },
  ]

  visSpec.signals = [
    {
      name: 'tooltip',
      value: {},
      on: [
        { events: 'rect:pointerover', update: 'datum' },
        { events: 'rect:pointerout', update: '{}' },
      ],
    },
  ]

  visSpec.scales = [
    {
      name: 'xscale',
      type: 'band',
      domain: { data: 'table', field: 'category' },
      range: 'width',
      padding: 0.05,
      round: true,
    },
    {
      name: 'yscale',
      domain: { data: 'table', field: 'amount' },
      nice: true,
      range: 'height',
    },
  ]

  visSpec.axes = [
    { orient: 'bottom', scale: 'xscale' },
    { orient: 'left', scale: 'yscale' },
  ]

  visSpec.marks = [
    {
      type: 'rect',
      from: { data: 'table' },
      encode: {
        enter: {
          x: { scale: 'xscale', field: 'category' },
          width: { scale: 'xscale', band: 1 },
          y: { scale: 'yscale', field: 'amount' },
          y2: { scale: 'yscale', value: 0 },
        },
        update: {
          fill: { value: 'steelblue' },
        },
        hover: {
          fill: { value: 'red' },
        },
      },
    },
    {
      type: 'text',
      encode: {
        enter: {
          align: { value: 'center' },
          baseline: { value: 'bottom' },
          fill: { value: '#333' },
        },
        update: {
          x: { scale: 'xscale', signal: 'tooltip.category', band: 0.5 },
          y: { scale: 'yscale', signal: 'tooltip.amount', offset: -2 },
          text: { signal: 'tooltip.amount' },
          fillOpacity: [{ test: 'datum === tooltip', value: 0 }, { value: 1 }],
        },
      },
    },
  ]

  return visSpec
}

function makeSpecForScatter(visSpec: Spec): Spec {
  visSpec.data = [
    {
      name: 'source',
      values: [],
    },
  ]

  visSpec.scales = [
    {
      name: 'x',
      type: 'linear',
      round: true,
      nice: true,
      zero: false,
      domain: { data: 'source', field: 'x' },
      range: 'width',
    },
    {
      name: 'y',
      type: 'linear',
      round: true,
      nice: true,
      zero: false,
      domain: { data: 'source', field: 'y' },
      range: 'height',
    },
  ]

  visSpec.axes = [
    {
      scale: 'x',
      grid: true,
      domain: false,
      orient: 'bottom',
      tickCount: 5,
      title: 'X-Axis',
      format: '.2f',
    },
    {
      scale: 'y',
      grid: true,
      domain: false,
      orient: 'left',
      titlePadding: 5,
      title: 'Y-Axis',
      format: '.2f',
    },
  ]

  visSpec.marks = [
    {
      name: 'marks',
      type: 'symbol',
      from: { data: 'source' },
      encode: {
        update: {
          x: { scale: 'x', field: 'x' },
          y: { scale: 'y', field: 'y' },
          shape: { value: 'circle' },
          strokeWidth: { value: 2 },
          opacity: { value: 0.7 },
          stroke: { value: '#4682b4' },
          fill: { value: 'transparent' },
        },
      },
    },
  ]

  return visSpec
}

function makeSpecForHistogram(visSpec: Spec): Spec {
  visSpec.signals = [
    {
      name: 'binOffset',
      value: 0,
    },
    {
      name: 'binStep',
      value: 0.1,
    },
  ]

  visSpec.data = [
    {
      name: 'points',
      url: 'https://vega.github.io/editor/data/normal-2d.json',
    },
    {
      name: 'binned',
      source: 'points',
      transform: [
        {
          type: 'bin',
          field: 'u',
          extent: [-1, 1],
          anchor: { signal: 'binOffset' },
          step: { signal: 'binStep' },
          nice: true,
        },
        {
          type: 'aggregate',
          key: 'bin0',
          groupby: ['bin0', 'bin1'],
          fields: ['bin0'],
          ops: ['count'],
          as: ['count'],
        },
      ],
    },
  ]

  visSpec.scales = [
    {
      name: 'xscale',
      type: 'linear',
      range: 'width',
      domain: [-1, 1],
    },
    {
      name: 'yscale',
      type: 'linear',
      range: 'height',
      round: true,
      domain: { data: 'binned', field: 'count' },
      zero: true,
      nice: true,
    },
  ]

  visSpec.axes = [
    {
      orient: 'bottom',
      scale: 'xscale',
      zindex: 1,
      titlePadding: 15,
      title: 'Value',
    },
    {
      orient: 'left',
      scale: 'yscale',
      tickCount: 5,
      zindex: 1,
      title: 'Frequency',
    },
  ]

  visSpec.marks = [
    {
      type: 'rect',
      from: { data: 'binned' },
      encode: {
        update: {
          x: { scale: 'xscale', field: 'bin0' },
          x2: {
            scale: 'xscale',
            field: 'bin1',
            offset: { signal: 'binStep > 0.02 ? -0.5 : 0' },
          },
          y: { scale: 'yscale', field: 'count' },
          y2: { scale: 'yscale', value: 0 },
          fill: { value: 'steelblue' },
        },
        hover: { fill: { value: 'firebrick' } },
      },
    },
    {
      type: 'rect',
      from: { data: 'points' },
      encode: {
        enter: {
          x: { scale: 'xscale', field: 'u' },
          width: { value: 1 },
          y: { value: 25, offset: { signal: 'height' } },
          height: { value: 5 },
          fill: { value: 'steelblue' },
          fillOpacity: { value: 0.4 },
        },
      },
    },
  ]

  return visSpec
}

function makeSpecForViolin(visSpec: Spec): Spec {
  visSpec.config = {
    axisBand: {
      bandPosition: 1,
      tickExtra: true,
      tickOffset: 0,
    },
  }

  visSpec.signals = [
    { name: 'plotWidth', value: 60 },
    { name: 'height', update: '(plotWidth + 10) * 3' },
    {
      name: 'trim',
      value: false,
    },
    {
      name: 'bandwidth',
      value: 0,
    },
  ]

  visSpec.data = [
    {
      name: 'penguins',
      url: 'https://vega.github.io/editor/data/penguins.json',
      transform: [
        {
          type: 'filter',
          expr: "datum.Species != null && datum['Body Mass (g)'] != null",
        },
      ],
    },
    {
      name: 'density',
      source: 'penguins',
      transform: [
        {
          type: 'kde',
          field: 'Body Mass (g)',
          groupby: ['Species'],
          bandwidth: { signal: 'bandwidth' },
          extent: { signal: 'trim ? null : [2000, 6500]' },
        },
      ],
    },
    {
      name: 'stats',
      source: 'penguins',
      transform: [
        {
          type: 'aggregate',
          groupby: ['Species'],
          fields: ['Body Mass (g)', 'Body Mass (g)', 'Body Mass (g)'],
          ops: ['q1', 'median', 'q3'],
          as: ['q1', 'median', 'q3'],
        },
      ],
    },
  ]

  visSpec.scales = [
    {
      name: 'layout',
      type: 'band',
      range: 'height',
      domain: { data: 'penguins', field: 'Species' },
    },
    {
      name: 'xscale',
      type: 'linear',
      range: 'width',
      round: true,
      domain: { data: 'penguins', field: 'Body Mass (g)' },
      domainMin: 2000,
      zero: false,
      nice: true,
    },
    {
      name: 'hscale',
      type: 'linear',
      range: [0, { signal: 'plotWidth' }],
      domain: { data: 'density', field: 'density' },
    },
    {
      name: 'color',
      type: 'ordinal',
      domain: { data: 'penguins', field: 'Species' },
      range: 'category',
    },
  ]

  visSpec.axes = [
    { orient: 'bottom', scale: 'xscale', zindex: 1 },
    { orient: 'left', scale: 'layout', tickCount: 5, zindex: 1 },
  ]

  visSpec.marks = [
    {
      type: 'group',
      from: {
        facet: {
          data: 'density',
          name: 'violin',
          groupby: 'Species',
        },
      },

      encode: {
        enter: {
          yc: { scale: 'layout', field: 'Species', band: 0.5 },
          height: { signal: 'plotWidth' },
          width: { signal: 'width' },
        },
      },

      data: [
        {
          name: 'summary',
          source: 'stats',
          transform: [
            {
              type: 'filter',
              expr: 'datum.Species === parent.Species',
            },
          ],
        },
      ],

      marks: [
        {
          type: 'area',
          from: { data: 'violin' },
          encode: {
            enter: {
              fill: { scale: 'color', field: { parent: 'Species' } },
            },
            update: {
              x: { scale: 'xscale', field: 'value' },
              yc: { signal: 'plotWidth / 2' },
              height: { scale: 'hscale', field: 'density' },
            },
          },
        },
        {
          type: 'rect',
          from: { data: 'summary' },
          encode: {
            enter: {
              fill: { value: 'black' },
              height: { value: 2 },
            },
            update: {
              x: { scale: 'xscale', field: 'q1' },
              x2: { scale: 'xscale', field: 'q3' },
              yc: { signal: 'plotWidth / 2' },
            },
          },
        },
        {
          type: 'rect',
          from: { data: 'summary' },
          encode: {
            enter: {
              fill: { value: 'black' },
              width: { value: 2 },
              height: { value: 8 },
            },
            update: {
              x: { scale: 'xscale', field: 'median' },
              yc: { signal: 'plotWidth / 2' },
            },
          },
        },
      ],
    },
  ]

  return visSpec
}
