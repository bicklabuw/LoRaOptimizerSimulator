import axios from 'axios';

const API_URL = 'http://localhost:8000';

export const optimizeNetwork = async (nodes, config, linkOverrides = []) => {
  // Convert frontend node format to backend Pydantic model
  const payload = {
    nodes: nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      lat: n.lat,
      lon: n.lon,
      radio_count: 1, 
      elevation_m: 0
    })),
    // Pass the overrides from state
    link_overrides: linkOverrides, 
    config: {
      ...config,
      num_channels: 1 
    }
  };

  console.log('API Payload:', payload);
  const response = await axios.post(`${API_URL}/optimize`, payload);
  console.log('API Response:', response.data);
  return response.data;
};