"use client";

import { useState, useEffect } from "react";
import {
  TextInput,
  Button,
  Group,
  Stack,
  Card,
  Title,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { IconDatabase } from "@tabler/icons-react";

export function DatabaseSettings() {
  const [connectionString, setConnectionString] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const store = await load("store.json", { autoSave: false, defaults: {} });
        const val = await store.get<string>("db_connection_string");
        if (val) {
          setConnectionString(val);
        }
      } catch (err) {
        console.error("Failed to load store:", err);
      }
    }
    init();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const store = await load("store.json", { autoSave: false, defaults: {} });
      await store.set("db_connection_string", connectionString);
      await store.save();
      notifications.show({
        title: "Success",
        message: "Settings saved successfully",
        color: "green",
      });
    } catch (err) {
      console.error(err);
      notifications.show({
        title: "Error",
        message: "Failed to save settings",
        color: "red",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!connectionString) {
      notifications.show({
        title: "Validation Error",
        message: "Please enter a connection string first.",
        color: "red",
      });
      return;
    }

    setIsTesting(true);
    try {
      const result = await invoke<string>("test_mssql_connection", {
        connectionString,
      });

      notifications.show({
        title: "Connection Successful",
        message: result,
        color: "green",
        icon: <IconDatabase size={18} />,
      });
    } catch (err) {
      const errorMessage = typeof err === "string" ? err : "Unknown error occurred";
      notifications.show({
        title: "Connection Failed",
        message: errorMessage,
        color: "red",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder>
      <Stack gap="md">
        <Title order={3}>Database Settings</Title>
        <Text size="sm" c="dimmed">
          Configure the Microsoft SQL Server connection for the application backend.
          Ensure that your connection string follows the standard ADO.NET format.
        </Text>

        <TextInput
          label="Connection String"
          placeholder="server=tcp:localhost,1433;user=sa;password=my_password;TrustServerCertificate=true"
          value={connectionString}
          onChange={(e) => setConnectionString(e.currentTarget.value)}
          required
        />

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={handleTestConnection} loading={isTesting}>
            Test Connection
          </Button>
          <Button onClick={handleSave} loading={isSaving}>
            Save
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
