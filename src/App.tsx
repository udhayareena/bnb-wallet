import React, { useState, useEffect } from 'react';
import { Wallet, Wallet as WalletOff, Users, Package, BarChart as ChartBar, History } from 'lucide-react';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

const COMPANY_WALLET = '0xE484201328c61Fbc8aCc316B9Ea4b2dC3A4EDEA9';

// Initialize Supabase client
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

interface ReferralNode {
  userId: number;
  referralId: string;
  children: ReferralNode[];
}

interface Package {
  id: string;
  name: string;
  bnb_amount: number;
}

interface Distribution {
  address: string;
  amount: string;
  percentage: number;
  type: string;
}

interface UserStats {
  direct_referrals_count: number;
  community_size: number;
}

interface UserBonus {
  bonus_type: string;
  amount: number;
  created_at: string;
}

function App() {
  const [account, setAccount] = useState<string>('');
  const [balance, setBalance] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string>('');
  const [userId, setUserId] = useState<number | null>(null);
  const [referralId, setReferralId] = useState<string>('');
  const [referralTree, setReferralTree] = useState<ReferralNode | null>(null);
  const [showReferralTree, setShowReferralTree] = useState(false);
  const [packages, setPackages] = useState<Package[]>([]);
  const [showPackages, setShowPackages] = useState(false);
  const [claimReferralId, setClaimReferralId] = useState('');
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [recentBonuses, setRecentBonuses] = useState<UserBonus[]>([]);
  const [showStats, setShowStats] = useState(false);
  const [totalBonuses, setTotalBonuses] = useState<Record<string, number>>({});

  const generateReferralId = (userId: number) => {
    return `242424${userId.toString().padStart(6, '0')}`;
  };

  const calculateDistributions = async (packageAmount: number): Promise<Distribution[]> => {
    const distributions: Distribution[] = [];
    
    try {
      // Get direct referrer
      const { data: userData, error: userError } = await supabase
        .from('wallet_users')
        .select('referrer_id')
        .eq('user_id', userId)
        .single();

      if (userError) throw userError;

      // Company share (10%)
      distributions.push({
        address: COMPANY_WALLET,
        amount: ethers.formatEther(ethers.parseEther(packageAmount.toString()) * BigInt(10) / BigInt(100)),
        percentage: 10,
        type: 'Company'
      });

      if (userData?.referrer_id) {
        // Get direct referrer's wallet address
        const { data: referrerData, error: referrerError } = await supabase
          .from('wallet_users')
          .select('wallet_address')
          .eq('user_id', userData.referrer_id)
          .single();

        if (referrerError) throw referrerError;

        if (referrerData) {
          // Direct referrer share (61.2% + 9%)
          distributions.push({
            address: referrerData.wallet_address,
            amount: ethers.formatEther(ethers.parseEther(packageAmount.toString()) * BigInt(702) / BigInt(1000)),
            percentage: 70.2,
            type: 'Direct Referrer'
          });

          // Get upper level referrers (up to 11 levels)
          let currentUserId = userData.referrer_id;
          let level = 1;
          
          while (level <= 11) {
            const { data: upperReferrer, error: upperError } = await supabase
              .from('wallet_users')
              .select('wallet_address, referrer_id')
              .eq('user_id', currentUserId)
              .single();

            if (upperError || !upperReferrer) break;

            if (level > 1) { // Skip first level as it's already handled
              distributions.push({
                address: upperReferrer.wallet_address,
                amount: ethers.formatEther(ethers.parseEther(packageAmount.toString()) * BigInt(18) / BigInt(1000)),
                percentage: 1.8,
                type: `Level ${level} Referrer`
              });
            }

            if (!upperReferrer.referrer_id) break;
            currentUserId = upperReferrer.referrer_id;
            level++;
          }
        }
      }

      // If distributions don't add up to 100%, send remainder to company wallet
      const totalPercentage = distributions.reduce((sum, dist) => sum + dist.percentage, 0);
      if (totalPercentage < 100) {
        const remainingPercentage = 100 - totalPercentage;
        distributions.push({
          address: COMPANY_WALLET,
          amount: ethers.formatEther(ethers.parseEther(packageAmount.toString()) * BigInt(Math.round(remainingPercentage * 10)) / BigInt(1000)),
          percentage: remainingPercentage,
          type: 'Company (Remainder)'
        });
      }

    } catch (err) {
      console.error('Error calculating distributions:', err);
      // If any error occurs, send everything to company wallet
      distributions.length = 0;
      distributions.push({
        address: COMPANY_WALLET,
        amount: packageAmount.toString(),
        percentage: 100,
        type: 'Company (Error Recovery)'
      });
    }

    return distributions;
  };

  const handlePackageSelection = async (pkg: Package) => {
    if (!window.ethereum || !account || processing) return;

    try {
      setProcessing(true);
      setError('');

      const distributions = await calculateDistributions(pkg.bnb_amount);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Execute all transfers
      for (const dist of distributions) {
        const tx = await signer.sendTransaction({
          to: dist.address,
          value: ethers.parseEther(dist.amount)
        });
        await tx.wait();
      }

      // Record the purchase in the database
      await supabase.from('package_purchases').insert([{
        user_id: userId,
        package_id: pkg.id,
        amount: pkg.bnb_amount,
        distributions: distributions
      }]);

      setShowPackages(false);
    } catch (err: any) {
      setError(`Failed to process package purchase: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const fetchPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('packages')
        .select('*')
        .order('bnb_amount', { ascending: true });

      if (error) throw error;
      setPackages(data || []);
    } catch (err: any) {
      setError(`Failed to fetch packages: ${err.message}`);
    }
  };

  const handleClaimReferral = async () => {
    if (!claimReferralId || !account) return;

    try {
      // Find the referrer's user ID from the referral ID
      const { data: referrer, error: referrerError } = await supabase
        .from('wallet_users')
        .select('user_id')
        .eq('referral_id', claimReferralId)
        .single();

      if (referrerError) {
        throw new Error('Invalid referral ID');
      }

      // Create new user with referrer
      const { data: newUser, error: createError } = await supabase
        .from('wallet_users')
        .insert([{
          wallet_address: account,
          referrer_id: referrer.user_id
        }])
        .select('user_id, referral_id')
        .single();

      if (createError) throw createError;

      if (newUser) {
        setUserId(newUser.user_id);
        setReferralId(newUser.referral_id);
        setShowClaimForm(false);
        setClaimReferralId('');
      }
    } catch (err: any) {
      setError(`Failed to claim referral: ${err.message}`);
    }
  };

  const fetchUserStats = async () => {
    if (!userId) return;

    try {
      // Fetch user stats
      const { data: stats, error: statsError } = await supabase
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (statsError) throw statsError;
      setUserStats(stats);

      // Fetch recent bonuses
      const { data: bonuses, error: bonusesError } = await supabase
        .from('user_bonuses')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (bonusesError) throw bonusesError;
      setRecentBonuses(bonuses);

      // Calculate total bonuses by type
      const { data: totalsByType, error: totalsError } = await supabase
        .from('user_bonuses')
        .select('bonus_type, amount')
        .eq('user_id', userId);

      if (totalsError) throw totalsError;

      const totals = totalsByType.reduce((acc, bonus) => {
        acc[bonus.bonus_type] = (acc[bonus.bonus_type] || 0) + Number(bonus.amount);
        return acc;
      }, {} as Record<string, number>);

      setTotalBonuses(totals);
    } catch (err: any) {
      setError(`Failed to fetch user statistics: ${err.message}`);
    }
  };

  const getOrCreateUserId = async (walletAddress: string) => {
    try {
      // Check if wallet address already has a user ID
      const { data: existingUser, error: fetchError } = await supabase
        .from('wallet_users')
        .select('user_id, referral_id')
        .eq('wallet_address', walletAddress)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      if (existingUser) {
        setUserId(existingUser.user_id);
        setReferralId(existingUser.referral_id);
        return;
      }

      // Show claim form for new users
      setShowClaimForm(true);
    } catch (err: any) {
      setError(`Failed to get/create user ID: ${err.message}`);
    }
  };

  const fetchReferralTree = async () => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .rpc('get_referral_tree', { root_user_id: userId });

      if (error) throw error;

      setReferralTree(data);
    } catch (err: any) {
      setError(`Failed to fetch referral tree: ${err.message}`);
    }
  };

  const connectWallet = async () => {
    try {
      if (!window.ethereum) {
        throw new Error('MetaMask is not installed');
      }

      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x38' }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x38',
              chainName: 'BNB Smart Chain',
              nativeCurrency: {
                name: 'BNB',
                symbol: 'BNB',
                decimals: 18
              },
              rpcUrls: ['https://bsc-dataseed.binance.org/'],
              blockExplorerUrls: ['https://bscscan.com/']
            }]
          });
        }
      }

      const connectedAccount = accounts[0];
      setAccount(connectedAccount);
      setIsConnected(true);
      setError('');
      
      await getOrCreateUserId(connectedAccount);
    } catch (err: any) {
      setError(err.message);
      setIsConnected(false);
    }
  };

  const updateBalance = async () => {
    if (account && window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const balance = await provider.getBalance(account);
        setBalance(ethers.formatEther(balance));
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  useEffect(() => {
    fetchPackages();
  }, []);

  useEffect(() => {
    if (isConnected) {
      updateBalance();
      const interval = setInterval(updateBalance, 10000);
      return () => clearInterval(interval);
    }
  }, [account, isConnected]);

  useEffect(() => {
    if (userId) {
      fetchReferralTree();
      fetchUserStats();
    }
  }, [userId]);

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', async (accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          await getOrCreateUserId(accounts[0]);
        } else {
          setAccount('');
          setIsConnected(false);
          setUserId(null);
          setReferralId('');
          setReferralTree(null);
        }
      });

      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners();
      }
    };
  }, []);

  const renderReferralTree = (node: ReferralNode) => {
    return (
      <div className="pl-4 border-l border-gray-600">
        <div className="py-2">
          <p className="text-sm">
            <span className="text-gray-400">User ID:</span> {node.userId}
          </p>
          <p className="text-sm">
            <span className="text-gray-400">Referral ID:</span> {node.referralId}
          </p>
        </div>
        {node.children.length > 0 && (
          <div className="pl-4">
            {node.children.map((child, index) => (
              <div key={index}>{renderReferralTree(child)}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-black text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="bg-gray-800 p-8 rounded-xl shadow-2xl mb-8">
            <div className="flex items-center justify-center mb-8">
              {isConnected ? (
                <Wallet className="w-16 h-16 text-green-400" />
              ) : (
                <WalletOff className="w-16 h-16 text-gray-400" />
              )}
            </div>

            <h1 className="text-2xl font-bold text-center mb-8">
              BNB Wallet Dashboard
            </h1>

            {!isConnected ? (
              <button
                onClick={connectWallet}
                className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
              >
                Connect MetaMask
              </button>
            ) : (
              <div className="space-y-4">
                {showClaimForm ? (
                  <div className="bg-gray-700 rounded-lg p-4">
                    <h3 className="text-lg font-semibold mb-4">Claim Referral</h3>
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="referralId" className="block text-sm font-medium text-gray-300 mb-2">
                          Enter Referral ID (optional)
                        </label>
                        <input
                          type="text"
                          id="referralId"
                          value={claimReferralId}
                          onChange={(e) => setClaimReferralId(e.target.value)}
                          placeholder="Enter referral ID or leave empty"
                          className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        onClick={handleClaimReferral}
                        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
                      >
                        Claim & Create Account
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {userId && (
                      <div className="bg-gray-700 rounded-lg p-4">
                        <p className="text-sm text-gray-400 mb-1">Company User ID</p>
                        <p className="text-xl font-bold">{userId}</p>
                      </div>
                    )}

                    {referralId && (
                      <div className="bg-gray-700 rounded-lg p-4">
                        <p className="text-sm text-gray-400 mb-1">Referral ID</p>
                        <p className="text-xl font-bold font-mono">{referralId}</p>
                      </div>
                    )}
                    
                    <div className="bg-gray-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">Wallet Address</p>
                      <p className="font-mono text-sm break-all">{account}</p>
                    </div>
                    
                    <div className="bg-gray-700 rounded-lg p-4">
                      <p className="text-sm text-gray-400 mb-1">BNB Balance</p>
                      <p className="text-2xl font-bold">{balance} BNB</p>
                    </div>

                    <div className="flex gap-4">
                      <button
                        onClick={() => setShowReferralTree(!showReferralTree)}
                        className="flex-1 py-3 px-6 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
                      >
                        <Users className="w-5 h-5" />
                        {showReferralTree ? 'Hide' : 'Show'} Referral Tree
                      </button>

                      <button
                        onClick={() => setShowPackages(!showPackages)}
                        className="flex-1 py-3 px-6 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
                      >
                        <Package className="w-5 h-5" />
                        {showPackages ? 'Hide' : 'Show'} Packages
                      </button>

                      <button
                        onClick={() => setShowStats(!showStats)}
                        className="flex-1 py-3 px-6 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
                      >
                        <ChartBar className="w-5 h-5" />
                        {showStats ? 'Hide' : 'Show'} Statistics
                      </button>
                    </div>

                    {showStats && userStats && (
                      <div className="mt-6 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-gray-700 p-4 rounded-lg">
                            <p className="text-sm text-gray-400">Direct Referrals</p>
                            <p className="text-2xl font-bold">{userStats.direct_referrals_count}</p>
                          </div>
                          <div className="bg-gray-700 p-4 rounded-lg">
                            <p className="text-sm text-gray-400">Community Size</p>
                            <p className="text-2xl font-bold">{userStats.community_size}</p>
                          </div>
                        </div>

                        <div className="bg-gray-700 p-4 rounded-lg">
                          <h3 className="text-lg font-semibold mb-4">Total Bonuses</h3>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-sm text-gray-400">Direct Bonus</p>
                              <p className="text-xl font-bold">{totalBonuses.direct?.toFixed(8) || '0'} BNB</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Referral Bonus</p>
                              <p className="text-xl font-bold">{totalBonuses.referral?.toFixed(8) || '0'} BNB</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Upgrade Bonus</p>
                              <p className="text-xl font-bold">{totalBonuses.upgrade?.toFixed(8) || '0'} BNB</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Level Up Bonus</p>
                              <p className="text-xl font-bold">{totalBonuses.level_up?.toFixed(8) || '0'} BNB</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Royalty Bonus</p>
                              <p className="text-xl font-bold">{totalBonuses.royalty?.toFixed(8) || '0'} BNB</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Reward Bonus</p>
                              <p className="text-xl font-bold">{totalBonuses.reward?.toFixed(8) || '0'} BNB</p>
                            </div>
                          </div>
                        </div>

                        <div className="bg-gray-700 p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-4">
                            <History className="w-5 h-5 text-gray-400" />
                            <h3 className="text-lg font-semibold">Recent Bonuses</h3>
                          </div>
                          <div className="space-y-2">
                            {recentBonuses.map((bonus, index) => (
                              <div key={index} className="flex justify-between items-center p-2 bg-gray-800 rounded">
                                <div>
                                  <p className="text-sm font-medium capitalize">
                                    {bonus.bonus_type.replace('_', ' ')} Bonus
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    {new Date(bonus.created_at).toLocaleDateString()}
                                  </p>
                                </div>
                                <p className="text-sm font-bold">{bonus.amount.toFixed(8)} BNB</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {showReferralTree && referralTree && (
                      <div className="mt-6 bg-gray-700 rounded-lg p-4">
                        <h2 className="text-xl font-bold mb-4">Referral Network</h2>
                        {renderReferralTree(referralTree)}
                      </div>
                    )}

                    {showPackages && (
                      <div className="mt-6 bg-gray-700 rounded-lg p-4">
                        <h2 className="text-xl font-bold mb-4">Available Packages</h2>
                        <div className="grid gap-4 md:grid-cols-2">
                          {packages.map((pkg) => (
                            <button 
                              key={pkg.id}
                              onClick={() => handlePackageSelection(pkg)}
                              disabled={processing}
                              className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-purple-500 transition-colors text-left"
                            >
                              <h3 className="text-lg font-semibold mb-2">{pkg.name}</h3>
                              <p className="text-2xl font-bold text-purple-400">
                                {pkg.bnb_amount} BNB
                              </p>
                              {processing && (
                                <p className="text-sm text-gray-400 mt-2">Processing...</p>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 p-4 bg-red-900/50 border border-red-500 rounded-lg">
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;