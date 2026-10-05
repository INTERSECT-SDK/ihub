# LLM Servers

An LLM server supplies the model used by a custom iHub agent. Configure the
model before creating the agent.

## Supported providers

iHub currently offers:

- **Ollama**
- **Azure**

## Add a server

1. Open **LLM Servers**.
2. Select **Create new LLM server**.
3. Complete the fields:

| Field | Ollama | Azure |
| --- | --- | --- |
| Name | Required | Required |
| URL | Required | Required |
| LLM Provider | `ollama` | `azure` |
| Model | Required | Required |
| API Key | Optional | Optional when the deployment does not require it |
| API Version | Not shown | Required |
| Deployment Name | Not shown | Required |

4. Submit the form.
5. Open **Agents** and select the new model while creating or editing a custom
   agent.

Use the exact model, deployment, and API-version values provided by the LLM
service owner.

## Manage a server

Expand a server to review its provider and model, edit its fields, or delete
it. A blank secret field during edit preserves the stored API key.

Deleting an LLM server makes custom agents that reference it unavailable.

## Troubleshooting

### The server is listed but an agent fails

The current list status does not perform a test prompt against the model.
Confirm the URL, provider, model name, credentials, and Azure deployment
details directly with the service owner.

### The model is absent from the agent form

Confirm that the LLM was created in the current project context, then reopen
the custom-agent form.

### An Azure request fails

Check both **API Version** and **Deployment Name**. They identify different
parts of the Azure deployment and are both required by the form.

## Related guides

- [AI Agents](configuration/agents.md)
- [Chat](applications/chat.md)
- [Configuration Overview](configuration/overview.md)
