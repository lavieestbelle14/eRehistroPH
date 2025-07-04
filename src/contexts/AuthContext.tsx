'use client';

import type { ReactNode, FC } from 'react';
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

// ---- TYPE DEFINITIONS ---- //

type UserRole = 'officer' | 'public';

export interface AuthenticatedUser {
  id: string; // Supabase auth user ID
  email: string;
  voterId?: string;
  precinct?: string;
  username: string;
  role: UserRole;
  registrationStatus?: 'pending' | 'verified' | 'approved' | 'disapproved' | null;
}

interface AuthContextType {
  isAuthenticated: boolean;
  login: (email: string, passwordAttempt: string) => Promise<void>;
  signUp: (username: string, email: string, passwordAttempt: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  user: AuthenticatedUser | null;
  updateUserProfile: (updates: { username?: string }) => Promise<boolean>;
  updateUserPassword: (oldPass: string, newPass: string) => Promise<boolean>;
  sendPasswordResetEmail: (email: string) => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

// ---- CONTEXT CREATION ---- //

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const publicUserAuthenticatedPaths = [
  '/public/home',
  '/public/track-status',
  '/public/application-submitted',
  '/public/profile',
  '/public/faq',
  '/public/schedule-biometrics'
];

const publicUnauthenticatedPaths = [
  '/auth',
  '/',
  '/landing',
  '/public/forgot-password',
  '/public/reset-password'
];

// Helper function to check if a path is allowed for unauthenticated users
const isPublicPath = (pathname: string): boolean => {
  return publicUnauthenticatedPaths.includes(pathname) || 
         pathname.includes('/reset-password') || 
         pathname.includes('/forgot-password');
};

// ---- AUTH PROVIDER COMPONENT ---- //

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordUpdateFlow, setIsPasswordUpdateFlow] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  // New function to handle URL hash after email confirmation
  const handleEmailConfirmation = useCallback(async () => {
    // Only run this in the browser
    if (typeof window === 'undefined') return;
    
    // Check if we have a hash in the URL (typically after email confirmation)
    if (window.location.hash && window.location.hash.includes('access_token')) {
      try {
        // Supabase automatically parses the hash, but we need to trigger a session check
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          // Show success toast
          toast({ 
            title: 'Email Verified!', 
            description: 'Your email has been verified successfully.',
          });
          
          // Clean up the URL by removing the hash
          window.history.replaceState({}, document.title, window.location.pathname);
          
          // If user confirmed their email but hasn't completed profile setup
          // handle that here (if needed)
        }
      } catch (error) {
        console.error('Error handling email confirmation:', error);
        toast({ 
          title: 'Verification Error', 
          description: 'There was an error verifying your email.',
          variant: 'destructive' 
        });
      }
    }
  }, [toast]);

const handleSession = useCallback(async (session: Session | null): Promise<AuthenticatedUser | null> => {
  const supabaseUser = session?.user;
  if (supabaseUser) {
    try {
      console.log('Processing session for user:', supabaseUser.id);
      
      // Check if session is valid and not expired
      if (session && session.expires_at && session.expires_at < Date.now() / 1000) {
        console.warn('Session expired, attempting to refresh...');
        const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession();
        
        if (refreshError) {
          console.error('Failed to refresh session:', refreshError);
          // Clear invalid session
          await supabase.auth.signOut();
          setUser(null);
          return null;
        }
        
        if (refreshedSession.session) {
          console.log('Session refreshed successfully');
          // Use the refreshed session
          session = refreshedSession.session;
        }
      }
      
      // First, just get the basic app_user record
      const { data: appUser, error: fetchError } = await supabase
        .from('app_user')
        .select('role, username')
        .eq('auth_id', supabaseUser.id)
        .single();

      console.log('Fetch result:', { appUser, fetchError });      
      
      if (fetchError) {
        if (fetchError.code === 'PGRST116') { // "single() row not found"
          console.warn(`No user profile found for auth_id: ${supabaseUser.id}. Creating user profile...`);
          
          // Create the app_user record in the database
          const { data: createdUser, error: createError } = await supabase
            .from('app_user')
            .insert({
              auth_id: supabaseUser.id,
              email: supabaseUser.email!,
              username: supabaseUser.user_metadata?.username || '',
              role: 'public'
            })
            .select('role, username')
            .single();

          if (createError) {
            // Check if it's a duplicate key error (user was created by another concurrent request)
            if (createError.code === '23505') {
              console.log('User profile already exists (created by concurrent request), fetching existing profile...');
              // Retry fetching the existing profile
              const { data: existingUser, error: refetchError } = await supabase
                .from('app_user')
                .select('role, username')
                .eq('auth_id', supabaseUser.id)
                .single();
              
              if (refetchError) {
                console.error('Error fetching existing user profile:', refetchError);
                setUser(null);
                return null;
              }
              
              console.log('Found existing user profile:', existingUser);
              // Continue with the existing user data
              const existingAuthUser: AuthenticatedUser = {
                id: supabaseUser.id,
                email: supabaseUser.email!,
                username: existingUser.username || '',
                role: existingUser.role as UserRole,
                registrationStatus: null,
              };
              setUser(existingAuthUser);
              return existingAuthUser;
            } else if (createError.code === '42501') {
              // RLS policy violation - likely during auth transition
              console.log('RLS policy violation during auth transition - using temporary user profile');
              const tempUser: AuthenticatedUser = {
                id: supabaseUser.id,
                email: supabaseUser.email!,
                username: supabaseUser.user_metadata?.username || '',
                role: 'public',
                registrationStatus: null,
              };
              setUser(tempUser);
              return tempUser;
            } else {
              console.error('Error creating user profile:', createError);
              // Don't show error toast during password update flow
              if (!isPasswordUpdateFlow) {
                toast({
                  title: 'Error',
                  description: 'Could not create user profile. Please try again.',
                  variant: 'destructive',
                });
              }
              setUser(null);
              return null;
            }
          }

          console.log('Created user profile:', createdUser);
          
          // Create user object with the newly created data
          const newUser: AuthenticatedUser = {
            id: supabaseUser.id,
            email: supabaseUser.email!,
            username: createdUser.username || '',
            role: createdUser.role as UserRole,
            registrationStatus: null,
          };
          setUser(newUser);
          return newUser;
        } else {
          // Handle other fetch errors (like 406 Not Acceptable during auth transitions)
          console.warn('Error fetching user profile (possibly during auth transition):', fetchError.message);
          
          // For certain errors during auth transitions, create a temporary user profile
          if (fetchError.code === '406' || fetchError.message.includes('Not Acceptable')) {
            console.log('406 error during auth transition - using temporary user profile');
            const tempUser: AuthenticatedUser = {
              id: supabaseUser.id,
              email: supabaseUser.email!,
              username: supabaseUser.user_metadata?.username || '',
              role: 'public',
              registrationStatus: null,
            };
            setUser(tempUser);
            return tempUser;
          }
          
          console.error('Error fetching user profile:', fetchError.message);
          // Don't show error toast during password update flow
          if (!isPasswordUpdateFlow) {
            toast({
              title: 'Error',
              description: 'Could not fetch user profile.',
              variant: 'destructive',
            });
          }
          setUser(null);
          return null;
        }
      } 
      
      if (appUser) {
        // Now try to get applicant and registration status in a separate query
        let registrationStatus = null;
        let voterId = null;
        let precinct = null;        try {
          const { data: applicantData, error: applicantError } = await supabase
            .from('applicant')
            .select(`
              applicant_id,
              application(application_type, status),
              applicant_voter_record(voter_id, precinct_number)
            `)
            .eq('auth_id', supabaseUser.id)
            .maybeSingle(); // Use maybeSingle() instead of single() to handle no records

          if (applicantError) {
            console.warn('Error fetching applicant data:', applicantError);
          } else if (applicantData) {
            // Find the registration application (handle both array and non-array cases)
            const applications = Array.isArray(applicantData.application) 
              ? applicantData.application 
              : applicantData.application 
                ? [applicantData.application] 
                : [];
                
            const registrationApp = applications.find(
              (app: any) => app.application_type === 'register'
            );
            registrationStatus = registrationApp?.status || null;
            
            // Get voter record if available
            // Note: Supabase returns one-to-one relations as arrays, so we access the first element
            const voterRecords = applicantData.applicant_voter_record;
            const voterRecord = Array.isArray(voterRecords) ? voterRecords[0] : voterRecords;
            voterId = voterRecord?.voter_id;
            precinct = voterRecord?.precinct_number;
          }
        } catch (applicantError) {
          // It's okay if applicant data doesn't exist yet
          console.log('No applicant data found (this is normal for new users)');
        }

        const authenticatedUser: AuthenticatedUser = {
          id: supabaseUser.id,
          email: supabaseUser.email!,
          username: appUser.username || supabaseUser.user_metadata?.username || '',
          role: appUser.role as UserRole,
          voterId,
          precinct,
          registrationStatus,
        };
        
        console.log('Final authenticated user:', authenticatedUser);
        setUser(authenticatedUser);
        return authenticatedUser;
      } else {
        // This case handles when a user exists in auth.users but not in app_user yet
        const tempUser: AuthenticatedUser = {
          id: supabaseUser.id,
          email: supabaseUser.email!,
          username: supabaseUser.user_metadata?.username || '',
          role: 'public',
          registrationStatus: null,
        };
        setUser(tempUser);
        return tempUser;
      }
    } catch (unexpectedError) {
      console.error('An unexpected error occurred during session handling:', unexpectedError);
      toast({ 
        title: 'Unexpected Error', 
        description: 'An unexpected error occurred while loading your profile.',
        variant: 'destructive' 
      });
      setUser(null);
      return null;
    }
  } else {
    setUser(null);
    return null;
  }
}, [toast]);

  const signUp = useCallback(async (username: string, email: string, passwordAttempt: string) => {
    const { data: existingUsers, error: checkError } = await supabase
      .from('app_user')
      .select('email')
      .eq('email', email);

    if (checkError) {
      toast({ title: 'Error', description: 'An error occurred while checking existing accounts.', variant: 'destructive' });
      return;
    }

    if (existingUsers && existingUsers.length > 0) {
      toast({ 
        title: 'Account Exists', 
        description: 'An account with this email already exists. Please log in instead.', 
        variant: 'destructive' 
      });
      return;
    }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: passwordAttempt,
    options: {
      data: {
        username: username,
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/auth`,
    },
  });

  // Debug logging for development
  if (process.env.NODE_ENV === 'development') {
    console.log('Sign up redirect URL:', `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/auth`);
  }

  if (error) {
    toast({ title: 'Sign Up Failed', description: error.message, variant: 'destructive' });
    return;
  }
  if (data.user) {
    // The user profile will be automatically created by the database trigger
    // No need to manually insert into app_user table
    toast({ 
      title: 'Sign Up Successful', 
      description: 'Your account has been created. Please check your email to confirm your account.' 
    });
  }
}, [toast]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/auth');
  }, [router]);

  const sendPasswordResetEmail = useCallback(async (email: string): Promise<boolean> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/public/reset-password`,
    });
    
    // Debug logging for development
    if (process.env.NODE_ENV === 'development') {
      console.log('Password reset redirect URL:', `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/public/reset-password`);
    }
    
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    toast({ title: 'Success', description: 'Password reset link sent. Please check your email.' });
    return true;
  }, [toast]);

  const updateUserPassword = useCallback(async (oldPass: string, newPass: string): Promise<boolean> => {
    if (!user) return false;
    
    try {
      // Mark that we're in a password update flow
      setIsPasswordUpdateFlow(true);
      
      // If oldPass is provided, require re-authentication (profile change)
      if (oldPass) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: oldPass,
        });
        if (signInError) {
          toast({ title: 'Incorrect Old Password', description: signInError.message, variant: 'destructive' });
          return false;
        }
      }
      
      // Update password (for both reset and profile change)
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) {
        toast({ title: 'Update Failed', description: error.message, variant: 'destructive' });
        return false;
      }
      
      // Show success message
      toast({ title: 'Password Updated', description: 'Your password has been successfully updated.' });
      
      // Note: Supabase will automatically sign out and sign back in the user
      // Our auth state handler will manage this transition
      
      // Clear the password update flow flag after a delay
      setTimeout(() => {
        setIsPasswordUpdateFlow(false);
      }, 3000);
      
      return true;
    } catch (error: any) {
      console.error('Error updating password:', error);
      setIsPasswordUpdateFlow(false);
      toast({ 
        title: 'Update Failed', 
        description: error.message || 'An unexpected error occurred.',
        variant: 'destructive' 
      });
      return false;
    }
  }, [toast, user]);

  const updateUserProfile = useCallback(async (updates: { username?: string }): Promise<boolean> => {
    if (!user) return false;

    const { error } = await supabase
      .from('profile')
      .update({ username: updates.username })
      .eq('auth_id', user.id);

    if (error) {
      toast({ title: 'Error', description: 'Failed to update profile.', variant: 'destructive' });
      return false;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    handleSession(session);
    
    toast({ title: 'Success', description: 'Your profile has been updated.' });
    return true;
  }, [user, handleSession, toast]);

  // Add the login function
const login = useCallback(async (email: string, passwordAttempt: string): Promise<void> => {
  setIsLoading(true);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: passwordAttempt,
  });

  if (error) {
    toast({ title: 'Login Failed', description: error.message, variant: 'destructive' });
    setIsLoading(false);
    return;
  }

  if (data.session) {
    const userData = await handleSession(data.session);
    toast({ title: 'Login Successful', description: 'You have been logged in.' });
    
    const redirectTo = userData?.role === 'officer' ? '/dashboard' : '/public/home';
    router.push(redirectTo);
  }
  setIsLoading(false);
}, [toast, handleSession, router]);  const refreshUser = useCallback(async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Error getting session:', error);
        // If we can't get session, try to refresh it
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          console.error('Failed to refresh session:', refreshError);
          // Clear the invalid session
          await supabase.auth.signOut();
          setUser(null);
          return;
        }
      }
      await handleSession(session);
    } catch (error) {
      console.error('Error refreshing user:', error);
      setUser(null);
    }
  }, [handleSession]);

  // Add a function to handle refresh token errors
  const handleRefreshTokenError = useCallback(async () => {
    console.log('Handling refresh token error - clearing session');
    try {
      await supabase.auth.signOut();
      setUser(null);
      toast({
        title: 'Session Expired',
        description: 'Please log in again.',
        variant: 'destructive',
      });
    } catch (error) {
      console.error('Error during sign out:', error);
    }
  }, [toast]);

useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let isProcessingPasswordUpdate = false;
    
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state change:', event);
      
      // Handle specific auth events
      if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
        return;
      } else if (event === 'USER_UPDATED') {
        console.log('User updated - likely password change');
        isProcessingPasswordUpdate = true;
        // Don't process session immediately, wait for subsequent events
        setTimeout(() => {
          isProcessingPasswordUpdate = false;
        }, 2000);
        return;
      } else if (event === 'SIGNED_OUT') {
        console.log('User signed out');
        // If this is part of a password update flow, don't clear user state
        if (isProcessingPasswordUpdate) {
          console.log('Sign out detected during password update - ignoring');
          return;
        }
        setUser(null);
        return;
      } else if (event === 'SIGNED_IN' && isProcessingPasswordUpdate) {
        console.log('User signed back in after password update');
        // Reset the flag and process normally
        isProcessingPasswordUpdate = false;
      }
      
      // Debounce rapid auth state changes to prevent race conditions
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        try {
          await handleSession(session);
        } catch (error: any) {
          console.error('Error in auth state change handler:', error);
          
          // Handle refresh token errors specifically (but not during password updates)
          if (!isProcessingPasswordUpdate && (error?.message?.includes('refresh') || error?.message?.includes('token'))) {
            await handleRefreshTokenError();
          }
        }
      }, 100);
    });

    supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (error) {
          console.error('Error getting initial session:', error);
          if (error.message?.includes('refresh') || error.message?.includes('token')) {
            handleRefreshTokenError();
          }
        } else {
          handleSession(session).finally(() => setIsLoading(false));
        }
    });

    handleEmailConfirmation();

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [handleSession, handleEmailConfirmation]);

useEffect(() => {
  if (isLoading) return;

  if (user) {
    // If officer is trying to access public pages
    if (user.role === 'officer' && pathname.startsWith('/public/')) {
      router.push('/dashboard');
    }
    // If public user is trying to access officer pages
    else if (user.role === 'public' && pathname.startsWith('/dashboard')) {
      router.push('/public/home');
    }  } 
  // If not authenticated and trying to access protected pages
  else if (!user && 
             !publicUserAuthenticatedPaths.includes(pathname) &&
             !isPublicPath(pathname)) {
    router.push('/auth');
  }
}, [user, isLoading, pathname, router, toast]);  const value = useMemo(() => ({
    isAuthenticated: !!user,
    user,
    isLoading,
    login,
    signUp,
    logout,
    updateUserProfile,
    updateUserPassword,
    sendPasswordResetEmail,
    refreshUser,
  }), [user, isLoading, login, signUp, logout, updateUserProfile, updateUserPassword, sendPasswordResetEmail, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ---- HOOK EXPORT ---- //

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

