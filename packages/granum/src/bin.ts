#!/usr/bin/env node
import process from 'node:process'
import { runGranumCli } from './cli'

process.exitCode = runGranumCli(process.argv.slice(2), {
  stdout: line => process.stdout.write(`${line}\n`),
  stderr: line => process.stderr.write(`${line}\n`),
})
