import SavedStrategy from '../domain/SavedStrategy.js';

export const saveStrategy = async (req, res) => {
  const { name, description, legs } = req.body;
  
  if (!name || !legs || legs.length === 0) {
    return res.status(400).json({ error: 'Name and legs are required' });
  }

  try {
    const strategy = await SavedStrategy.create({
      user: req.user._id,
      name,
      description,
      legs
    });
    res.status(201).json(strategy);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getSavedStrategies = async (req, res) => {
  try {
    const strategies = await SavedStrategy.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(strategies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteSavedStrategy = async (req, res) => {
  try {
    const strategy = await SavedStrategy.findById(req.params.id);
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
    if (strategy.user.toString() !== req.user._id.toString()) return res.status(401).json({ error: 'Unauthorized' });
    
    await SavedStrategy.deleteOne({ _id: req.params.id });
    res.json({ message: 'Strategy removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
