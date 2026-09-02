import pytest
from app.core.redis import get_redis
from app.main import app

class AllowRedis:
    async def eval(self, *args):
        return 1

async def _auth_headers(client, email='agent_stream@example.com'):
    response = await client.post('/api/v1/auth/register', json={'email': email, 'password': 'password123'})
    return {'Authorization': f'Bearer {response.json()["access_token"]}'}

@pytest.mark.asyncio
async def test_agent_stream_endpoint(client):
    app.dependency_overrides[get_redis] = lambda: AllowRedis()
    headers = await _auth_headers(client)
    project = await client.post('/api/v1/projects', json={'name': 'Agent Stream Project'}, headers=headers)
    project_id = project.json()['id']

    response = await client.post(
        f'/api/v1/projects/{project_id}/agent/stream',
        json={
            'prompt': 'Write a helper function',
            'active_file': 'src/utils.py',
            'file_content': '# existing code',
            'workspace_files': ['src/utils.py', 'src/main.py'],
            'instruction_mode': 'edit'
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert 'text/event-stream' in response.headers.get('content-type', '')
    assert 'event: token' in response.text
    assert 'event: done' in response.text
