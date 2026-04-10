import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import {
  Container, Paper, Title, Select, Button, Text, Group, Stack,
  TextInput, Table, ActionIcon, Grid, Badge, ScrollArea, Loader, Modal
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHistory, IconCloudUpload, IconCheck, IconX, IconAlertCircle, IconDeviceDesktop, IconTrash } from '@tabler/icons-react';
import { API_URL } from '../config';

// --- CUSTOM ANIMATION STYLES ---
const customStyles = `
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes popIn {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-row {
    animation: slideIn 0.3s ease-out forwards;
  }
  .hover-scale {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .hover-scale:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 15px rgba(0, 0, 0, 0.1);
  }
  .btn-bounce:active {
    transform: scale(0.95);
  }
`;

function Generator() {
  // --- STATE ---
  const [manufacturers, setManufacturers] = useState([]);
  const [models, setModels] = useState([]);

  const [selectedMan, setSelectedMan] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");

  const [deviceQueue, setDeviceQueue] = useState([]);
  const [loadingManufacturers, setLoadingManufacturers] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [backendError, setBackendError] = useState(null);

  const [lastUsed, setLastUsed] = useState(null);

  // Results modal (shown after push completes)
  const [opened, { open, close }] = useDisclosure(false);
  const [pushResults, setPushResults] = useState([]);
  const [isPushing, setIsPushing] = useState(false);

  // Confirmation modal (shown before push starts)
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  // --- SESSIONSTORAGE: Restore queue on page load ---
  useEffect(() => {
    const saved = sessionStorage.getItem('deviceQueue');
    if (saved) {
      try { setDeviceQueue(JSON.parse(saved)); } catch (_) {}
    }
  }, []);

  // --- SESSIONSTORAGE: Persist queue on every change ---
  useEffect(() => {
    sessionStorage.setItem('deviceQueue', JSON.stringify(deviceQueue));
  }, [deviceQueue]);

  // --- DATA FETCHING ---
  useEffect(() => {
    setLoadingManufacturers(true);
    fetch(`${API_URL}/manufacturers`)
      .then(res => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) setManufacturers(data);
      })
      .catch(() => setBackendError("Backend offline. Is uvicorn running?"))
      .finally(() => setLoadingManufacturers(false));

    // Load default manufacturer from saved settings (only if nothing already selected)
    fetch(`${API_URL}/config`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.default_manufacturer) {
          setSelectedMan(prev => prev || data.default_manufacturer);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedMan) {
      setLoadingModels(true);
      fetch(`${API_URL}/models?manufacturer=${selectedMan}`)
        .then(res => res.json())
        .then(data => {
          setModels(Array.isArray(data) ? data : []);
          if (selectedModel && Array.isArray(data) && !data.includes(selectedModel)) {
            setSelectedModel("");
          }
          setLoadingModels(false);
        })
        .catch(() => setLoadingModels(false));
    } else {
      setModels([]);
    }
  }, [selectedMan]);

  // --- VALIDATION ---
  const getSerialWarning = () => {
    if (!serialNumber || !selectedMan) return null;
    const cleanSerial = serialNumber.trim().toUpperCase();
    const man = selectedMan.toLowerCase();
    if (man.includes("dell")) {
      if (!/^[A-Z0-9]{7}$/.test(cleanSerial)) return "Dell Service Tags are typically 7 alphanumeric characters.";
    }
    if (man.includes("hp") || man.includes("hewlett")) {
      if (!/^[A-Z0-9]{10}$/.test(cleanSerial)) return "HP serials are typically 10 characters long.";
    }
    if (man.includes("lenovo")) {
      if (cleanSerial.length < 8) return "Lenovo serials are usually at least 8 characters.";
    }
    return null;
  };
  const serialWarning = getSerialWarning();

  // --- ACTIONS ---
  const addDeviceToQueue = () => {
    if (!selectedMan || !selectedModel || !serialNumber) {
      alert("Please fill in all fields.");
      return;
    }
    if (deviceQueue.some(d => d.serial === serialNumber.toUpperCase().trim())) {
      alert("This serial number is already in your queue!");
      return;
    }
    const newDevice = {
      manufacturer: selectedMan,
      model: selectedModel,
      serial: serialNumber.toUpperCase().trim()
    };
    setDeviceQueue([...deviceQueue, newDevice]);
    setLastUsed({ manufacturer: selectedMan, model: selectedModel });
    setSerialNumber("");
  };

  const removeDevice = (indexToRemove) => {
    setDeviceQueue(deviceQueue.filter((_, index) => index !== indexToRemove));
  };

  const clearQueue = () => {
    if (deviceQueue.length === 0) return;
    if (!confirm(`Clear all ${deviceQueue.length} device${deviceQueue.length !== 1 ? 's' : ''} from the queue?`)) return;
    setDeviceQueue([]);
  };

  const recallLastUsed = () => {
    if (!lastUsed) return;
    setSelectedMan(lastUsed.manufacturer);
    setSelectedModel(lastUsed.model);
  };

  const exportToCSV = () => {
    if (deviceQueue.length === 0) return;
    const exportData = deviceQueue.map(dev => [dev.manufacturer, dev.model, dev.serial]);
    const csv = Papa.unparse({ data: exportData, fields: null }, { header: false });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Intune_Corporate_Identifiers.csv');
    link.click();
  };

  // Step 1: Open confirmation modal
  const handlePushToIntune = () => {
    openConfirm();
  };

  // Step 2: User confirmed — execute the actual push
  const executePush = async () => {
    closeConfirm();
    setIsPushing(true);
    setPushResults([]);
    open();
    try {
      const response = await fetch(`${API_URL}/push-to-intune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devices: deviceQueue })
      });
      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.detail
          ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))
          : "Server Error";
        setPushResults([{ serial: "System", status: 'error', message: errorMsg }]);
      } else if (data.results) {
        setPushResults(data.results);
      } else {
        setPushResults([{ serial: "System", status: 'error', message: "Invalid response format" }]);
      }
    } catch (error) {
      setPushResults([{ serial: "System", status: 'error', message: 'Failed to contact backend.' }]);
    } finally {
      setIsPushing(false);
    }
  };

  const optionsFilter = ({ options, search }) => {
    const splittedSearch = search.toLowerCase().trim().split(" ");
    return options.filter((option) => {
      const label = option.label.toLowerCase();
      return splittedSearch.every((searchWord) => label.includes(searchWord));
    });
  };

  // --- UI RENDER ---
  return (
    <Container size="xl" py="xl">
      <style>{customStyles}</style>

      <Stack gap="lg">

        {backendError && (
          <Badge color="red" size="lg" variant="filled" leftSection={<IconAlertCircle size={14}/>}>
            {backendError}
          </Badge>
        )}

        <Grid gutter="lg">

          {/* LEFT COLUMN: INPUT FORM */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Paper shadow="sm" p="lg" radius="lg" withBorder h="100%">
              <Title order={4} mb="md" c="gray.7">Add Device</Title>

              <Stack gap="md">
                <Select
                  label="Manufacturer"
                  placeholder={loadingManufacturers ? "Loading..." : "Select Vendor"}
                  data={manufacturers}
                  value={selectedMan}
                  onChange={setSelectedMan}
                  searchable
                  variant="filled"
                  radius="md"
                  disabled={loadingManufacturers}
                  rightSection={loadingManufacturers ? <Loader size="xs" /> : null}
                />

                <Select
                  label="Model"
                  placeholder={loadingModels ? "Loading..." : "Search Model..."}
                  data={models}
                  value={selectedModel}
                  onChange={setSelectedModel}
                  disabled={!selectedMan || loadingModels}
                  searchable
                  filter={optionsFilter}
                  rightSection={loadingModels ? <Loader size="xs" /> : null}
                  variant="filled"
                  radius="md"
                />

                <TextInput
                  label="Serial Number"
                  placeholder="e.g. 5CD1234..."
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.currentTarget.value)}
                  error={serialWarning}
                  variant="filled"
                  radius="md"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addDeviceToQueue();
                  }}
                />

                <Button
                  onClick={addDeviceToQueue}
                  fullWidth
                  mt="sm"
                  size="md"
                  radius="md"
                  className="btn-bounce"
                  variant="gradient"
                  gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
                  style={{ transition: 'transform 0.1s' }}
                >
                  Add to Queue
                </Button>

                {lastUsed && (
                  <Button
                    variant="light"
                    color="gray"
                    fullWidth
                    size="xs"
                    radius="md"
                    className="btn-bounce"
                    leftSection={<IconHistory size={14} />}
                    onClick={recallLastUsed}
                  >
                    Quick Load: {lastUsed.model}
                  </Button>
                )}

              </Stack>
            </Paper>
          </Grid.Col>

          {/* RIGHT COLUMN: QUEUE TABLE */}
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Paper shadow="sm" p="lg" radius="lg" withBorder h="100%">
              <Group justify="space-between" mb="md">
                <Group gap="xs">
                  <Title order={4} c="gray.7">Queue</Title>
                  <Badge
                    circle
                    size="lg"
                    gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
                    variant="gradient"
                  >
                    {deviceQueue.length}
                  </Badge>
                </Group>

                <Group gap="xs">
                  <Button
                    onClick={clearQueue}
                    disabled={deviceQueue.length === 0}
                    color="red"
                    variant="light"
                    radius="md"
                    className="btn-bounce"
                    leftSection={<IconTrash size={16} />}
                  >
                    Clear
                  </Button>

                  <Button
                    onClick={exportToCSV}
                    disabled={deviceQueue.length === 0}
                    color="green"
                    variant="light"
                    radius="md"
                    className="btn-bounce"
                  >
                    CSV
                  </Button>

                  <Button
                    onClick={handlePushToIntune}
                    disabled={deviceQueue.length === 0}
                    color="blue"
                    radius="md"
                    className="btn-bounce"
                    leftSection={<IconCloudUpload size={18} />}
                  >
                    Push to Intune
                  </Button>
                </Group>
              </Group>

              <ScrollArea h={400} type="auto" offsetScrollbars>
                <Table striped highlightOnHover verticalSpacing="sm" withRowBorders={false}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Manufacturer</Table.Th>
                      <Table.Th>Model</Table.Th>
                      <Table.Th>Serial</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {deviceQueue.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Stack align="center" py="xl" gap="xs" c="dimmed" style={{ opacity: 0.5 }}>
                            <IconDeviceDesktop size={48} stroke={1.5} />
                            <Text size="sm">Queue is empty. Ready for input.</Text>
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : (
                      deviceQueue.map((device, index) => (
                        <Table.Tr key={index} className="animate-row" style={{ animationDelay: `${index * 0.05}s` }}>
                          <Table.Td>{device.manufacturer}</Table.Td>
                          <Table.Td>{device.model}</Table.Td>
                          <Table.Td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#228be6' }}>
                            {device.serial}
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <ActionIcon
                              color="red"
                              variant="subtle"
                              radius="xl"
                              onClick={() => removeDevice(index)}
                              className="btn-bounce"
                            >
                              ✕
                            </ActionIcon>
                          </Table.Td>
                        </Table.Tr>
                      ))
                    )}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          </Grid.Col>

        </Grid>
      </Stack>

      {/* --- CONFIRMATION MODAL --- */}
      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={<Text fw={700}>Confirm Push to Intune</Text>}
        size="sm"
        centered
        radius="lg"
        overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
      >
        <Stack>
          <Text size="sm">
            You are about to register <strong>{deviceQueue.length} device{deviceQueue.length !== 1 ? 's' : ''}</strong> with Microsoft Intune.
          </Text>
          <Text size="xs" c="dimmed">
            This will call the live Graph API. Devices with matching serials will be overwritten.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" radius="md" onClick={closeConfirm}>Cancel</Button>
            <Button color="blue" radius="md" leftSection={<IconCloudUpload size={16} />} onClick={executePush}>
              Confirm Push
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* --- RESULTS MODAL --- */}
      <Modal
        opened={opened}
        onClose={close}
        title={<Text fw={700} c="blue">Intune Sync Status</Text>}
        size="lg"
        centered
        radius="lg"
        overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
      >
        <Stack>
          {isPushing && (
            <Stack align="center" py="xl">
              <Loader size="lg" type="dots" color="blue" />
              <Text size="sm" c="dimmed" fs="italic">Syncing with Microsoft Graph...</Text>
            </Stack>
          )}

          {!isPushing && pushResults.length === 0 && (
            <Text c="dimmed" size="sm">Initializing upload...</Text>
          )}

          {pushResults.length > 0 && (
            <ScrollArea h={300} offsetScrollbars>
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Device</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Details</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pushResults.map((res, index) => (
                    <Table.Tr key={index} style={{ animation: 'popIn 0.3s ease-out forwards', animationDelay: `${index * 0.05}s` }}>
                      <Table.Td fw={600} style={{ fontFamily: 'monospace' }}>{res.serial || "N/A"}</Table.Td>
                      <Table.Td>
                        {res.status === 'success' ? (
                          <Badge color="teal" variant="light" leftSection={<IconCheck size={12}/>}>Success</Badge>
                        ) : (
                          <Badge color="red" variant="light" leftSection={<IconX size={12}/>}>Failed</Badge>
                        )}
                      </Table.Td>
                      <Table.Td style={{ fontSize: '0.85rem', color: 'gray' }}>
                        {res.message}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}

          {!isPushing && (
            <Button fullWidth onClick={close} variant="light" color="gray" radius="md">
              Close Report
            </Button>
          )}
        </Stack>
      </Modal>

    </Container>
  );
}

export default Generator;
