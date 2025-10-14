#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import * as babel from '@babel/core';

const program = new Command();

program
  .name('causeway')
  .description('Causeway instrumentation CLI')
  .version('0.1.0');

/**
 * Instrument command - automatically add Causeway instrumentation to code
 */
program
  .command('instrument <path>')
  .description('Instrument JavaScript/TypeScript files with Causeway events')
  .option('-o, --output <dir>', 'Output directory for instrumented files')
  .option('--no-functions', 'Skip instrumenting function calls')
  .option('--no-assignments', 'Skip instrumenting variable assignments')
  .option('--no-async', 'Skip instrumenting async operations')
  .option('--exclude <patterns...>', 'File patterns to exclude')
  .option('--dry-run', 'Show what would be instrumented without writing files')
  .action(async (inputPath: string, options) => {
    console.log('🔍 Causeway Instrumentation\n');

    // Find all files to instrument
    const pattern = inputPath.endsWith('.js') || inputPath.endsWith('.ts')
      ? inputPath
      : `${inputPath}/**/*.{js,ts}`;

    console.log(`📂 Searching for files: ${pattern}`);
    const files = await glob(pattern, {
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        ...(options.exclude || []),
      ],
    });

    if (files.length === 0) {
      console.log('❌ No files found to instrument');
      return;
    }

    console.log(`✅ Found ${files.length} files\n`);

    let instrumentedCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        console.log(`📝 Instrumenting: ${file}`);

        const code = fs.readFileSync(file, 'utf-8');

        const result = babel.transformSync(code, {
          filename: file,
          plugins: [
            [
              'babel-plugin-causeway',
              {
                instrumentFunctions: options.functions,
                instrumentAssignments: options.assignments,
                instrumentAsync: options.async,
              },
            ],
          ],
          presets: [
            ['@babel/preset-typescript', { allowDeclareFields: true }],
          ],
        });

        if (!result || !result.code) {
          console.log(`   ⚠️  Skipped (no output)`);
          continue;
        }

        if (options.dryRun) {
          console.log(`   ✓ Would instrument (dry run)`);
          instrumentedCount++;
          continue;
        }

        // Determine output path
        const outputPath = options.output
          ? path.join(options.output, path.relative(process.cwd(), file))
          : file;

        // Create output directory if needed
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Write instrumented code
        fs.writeFileSync(outputPath, result.code, 'utf-8');
        console.log(`   ✓ Instrumented successfully`);
        instrumentedCount++;
      } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        errorCount++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Instrumented: ${instrumentedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📁 Total: ${files.length}`);

    if (!options.dryRun && instrumentedCount > 0) {
      console.log(`\n💡 Next steps:`);
      console.log(`   1. Start Causeway server: causeway serve`);
      console.log(`   2. Run your instrumented code`);
      console.log(`   3. View results: causeway tui`);
    }
  });

/**
 * Init command - create causeway configuration
 */
program
  .command('init')
  .description('Initialize Causeway in your project')
  .action(() => {
    console.log('🚀 Initializing Causeway\n');

    // Create .causewayrc.json
    const config = {
      serverUrl: 'http://localhost:8080',
      serviceName: path.basename(process.cwd()),
      environment: 'development',
      enabled: true,
      batchSize: 100,
      flushInterval: 1000,
      instrumentation: {
        functions: true,
        assignments: true,
        async: true,
        exclude: ['node_modules/**', 'dist/**', 'build/**'],
      },
    };

    fs.writeFileSync(
      '.causewayrc.json',
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    console.log('✅ Created .causewayrc.json');

    // Check if package.json exists
    if (fs.existsSync('package.json')) {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

      if (!pkg.dependencies?.['causeway-sdk']) {
        console.log('\n💡 Add causeway-sdk to your dependencies:');
        console.log('   npm install causeway-sdk');
      }

      if (!pkg.devDependencies?.['babel-plugin-causeway']) {
        console.log('\n💡 Add babel-plugin-causeway to your dev dependencies:');
        console.log('   npm install --save-dev babel-plugin-causeway');
      }
    }

    console.log('\n✨ Causeway initialized!');
    console.log('\n📖 Next steps:');
    console.log('   1. Install dependencies: npm install');
    console.log('   2. Instrument your code: causeway instrument ./src');
    console.log('   3. Start Causeway server: causeway serve');
    console.log('   4. Run your app');
    console.log('   5. View results: causeway tui');
  });

/**
 * Status command - check causeway server status
 */
program
  .command('status')
  .description('Check Causeway server status')
  .option('-u, --url <url>', 'Server URL', 'http://localhost:8080')
  .action(async (options) => {
    console.log('🔍 Checking Causeway server status...\n');

    try {
      const response = await fetch(`${options.url}/status`);
      const data = await response.json();

      if (data.success && data.data) {
        console.log('✅ Server is running\n');
        console.log('📊 Statistics:');
        console.log(`   Events captured: ${data.data.events_captured}`);
        console.log(`   Active traces: ${data.data.traces_active}`);
        console.log(`   Version: ${data.data.version}`);
      } else {
        console.log('⚠️  Server responded but with unexpected data');
      }
    } catch (error) {
      console.log('❌ Server is not running');
      console.log(`   URL: ${options.url}`);
      console.log('\n💡 Start the server with: causeway serve');
    }
  });

program.parse();
