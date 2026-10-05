'use client'

import { Box, Tooltip } from '@mantine/core'

import classes from './style.module.css'

/** Displays the accessible, non-animated active campaign status marker. */
export default function ActiveCampaignIndicator() {
  return (
    <Tooltip label='Campaign is active'>
      <Box
        aria-label='Campaign is active'
        className={classes.indicator}
        component='span'
        role='status'
      />
    </Tooltip>
  )
}
