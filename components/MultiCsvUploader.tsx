'use client';

import React, { useState } from 'react';
import { 
  Group, 
  Text, 
  useMantineTheme, 
  rem, 
  Stack, 
  Button, 
  Table, 
  ScrollArea, 
  Paper,
  Title
} from '@mantine/core';
import { Dropzone, FileWithPath } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconUpload, IconFile, IconX, IconCheck, IconDownload } from '@tabler/icons-react';
import Papa from 'papaparse';

// Define the shape of our parsed rows. Keys will be standardized column headers.
export type DataRow = Record<string, string | number>;

export function MultiCsvUploader() {
  const theme = useMantineTheme();
  
  // State for tracking the upload and processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedData, setProcessedData] = useState<DataRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  
  // Handlers for the Dropzone component
  const handleDrop = async (files: FileWithPath[]) => {
    // 1. Validate files: Dropzone filters by accept, but we double-check here
    const csvFiles = files.filter(f => f.type === 'text/csv' || f.name.toLowerCase().endsWith('.csv'));
    
    if (csvFiles.length < files.length) {
      notifications.show({
        title: 'Invalid File Type',
        message: 'Some uploaded files were not CSVs and have been ignored.',
        color: 'red',
        icon: <IconX style={{ width: rem(18), height: rem(18) }} />,
      });
    }

    if (csvFiles.length === 0) return;

    setIsProcessing(true);

    try {
      const allRows: DataRow[] = [...processedData];
      const allHeaders = new Set<string>(columns);

      // 2. Parse all files asynchronously
      const parsePromises = csvFiles.map(file => {
        return new Promise<void>((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true, // Gracefully ignore empty rows
            // Standardize column casing and trim whitespace before matching
            transformHeader: (header) => header.trim().toLowerCase(),
            complete: (results) => {
              if (results.meta.fields) {
                // Collect all standardized headers
                results.meta.fields.forEach(field => allHeaders.add(field));
              }
              // Add parsed rows to our unified collection
              allRows.push(...(results.data as DataRow[]));
              resolve();
            },
            error: (error) => reject(error),
          });
        });
      });

      await Promise.all(parsePromises);

      // 3. Missing Data Handling: Standardize all rows
      const headersArray = Array.from(allHeaders);
      
      const combinedData = allRows.map((row) => {
        const completeRow = { ...row };
        headersArray.forEach((header) => {
          // If a column header is missing in this particular row's file,
          // populate it with the integer 0.
          if (!(header in completeRow) || completeRow[header] === '') {
            completeRow[header] = 0;
          }
        });
        return completeRow;
      });

      setColumns(headersArray);
      setProcessedData(combinedData);

      notifications.show({
        title: 'Success',
        message: `Successfully processed ${csvFiles.length} file(s) and matched columns.`,
        color: 'green',
        icon: <IconCheck style={{ width: rem(18), height: rem(18) }} />,
      });

    } catch (error) {
      notifications.show({
        title: 'Processing Error',
        message: 'There was an error while processing the CSV files.',
        color: 'red',
        icon: <IconX style={{ width: rem(18), height: rem(18) }} />,
      });
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = () => {
    notifications.show({
      title: 'Upload Rejected',
      message: 'Upload failed. Please ensure you are only uploading CSV files.',
      color: 'red',
      icon: <IconX style={{ width: rem(18), height: rem(18) }} />,
    });
  };

  const handleDownload = () => {
    if (processedData.length === 0) return;

    // Convert our unified data back into a CSV payload
    const csvExport = Papa.unparse({
      fields: columns,
      data: processedData,
    });

    // Create a Blob and trigger download
    const blob = new Blob([csvExport], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.setAttribute('download', 'merged_pipeline_data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClear = () => {
    setProcessedData([]);
    setColumns([]);
  };

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <Title order={3}>Upload Pipeline Data</Title>
          <Text size="sm" c="dimmed">
            Upload multiple CSV files below. Disparate columns will be combined, 
            and missing data populated with zeroes. Empty rows are automatically ignored.
          </Text>

          <Dropzone
            onDrop={handleDrop}
            onReject={handleReject}
            maxSize={10 * 1024 ** 2} // 10MB
            accept={['text/csv', 'application/vnd.ms-excel']}
            loading={isProcessing}
            autoFocus
          >
            <Group justify="center" gap="xl" mih={220} style={{ pointerEvents: 'none' }}>
              <Dropzone.Accept>
                <IconUpload
                  style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-blue-6)' }}
                  stroke={1.5}
                />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX
                  style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-red-6)' }}
                  stroke={1.5}
                />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconFile
                  style={{ width: rem(52), height: rem(52), color: 'var(--mantine-color-dimmed)' }}
                  stroke={1.5}
                />
              </Dropzone.Idle>

              <div>
                <Text size="xl" inline>
                  Drag CSV files here or click to select files
                </Text>
                <Text size="sm" c="dimmed" inline mt={7}>
                  Attach as many files as you like. They will be merged dynamically.
                </Text>
              </div>
            </Group>
          </Dropzone>
        </Stack>
      </Paper>

      {/* Preview Section */}
      {processedData.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={4}>Merged Data Preview</Title>
              <Group>
                <Button variant="default" onClick={handleClear}>Clear</Button>
                <Button leftSection={<IconDownload size={16} />} onClick={handleDownload} color="blue">
                  Download Unified CSV
                </Button>
              </Group>
            </Group>

            <ScrollArea h={400}>
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    {columns.map((col) => (
                      <Table.Th key={col}>{col.toUpperCase()}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {processedData.slice(0, 100).map((row, idx) => (
                    <Table.Tr key={idx}>
                      {columns.map((col) => (
                        <Table.Td key={col}>{row[col]}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            {processedData.length > 100 && (
              <Text c="dimmed" size="xs" ta="center">
                Showing first 100 rows. Download the CSV to view all {processedData.length} records.
              </Text>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
