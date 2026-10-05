import React from 'react'
import { Group } from '@mantine/core'
import classes from './TopMenuBar.module.css'

type propsType = {
  leftItems: React.ReactNode
  rightItems: React.ReactNode
  centerItems?: React.ReactNode
  pb?: number
}

export function TopMenuBar({
  leftItems,
  rightItems,
  centerItems,
  pb = 20,
}: propsType) {
  return (
    <div
      className={classes.outerContainer}
      style={{
        paddingBottom: pb,
      }}
    >
      <div className={classes.innerContainer}>
        <Group
          gap='sm'
          wrap='nowrap'
          justify='left'
          style={{ justifySelf: 'start' }}
        >
          {leftItems}
        </Group>
        <Group
          gap='sm'
          wrap='nowrap'
          justify='center'
          style={{ justifySelf: 'center' }}
        >
          {centerItems}
        </Group>
        <Group
          gap='sm'
          wrap='nowrap'
          justify='right'
          style={{ justifySelf: 'end' }}
        >
          {rightItems}
        </Group>
      </div>
    </div>
  )
}
